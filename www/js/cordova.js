 <script type="text/javascript">
/*
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
*/

// Workaround for Windows 10 in hosted environment case
// http://www.w3.org/html/wg/drafts/html/master/browsers.html#named-access-on-the-window-object
if (window.cordova && !(window.cordova instanceof HTMLElement)) {
    throw new Error("cordova already defined");
}


var channel = require('cordova/channel');
var platform = require('cordova/platform');


/**
 * Intercept calls to addEventListener + removeEventListener and handle deviceready,
 * resume, and pause events.
 */
var m_document_addEventListener = document.addEventListener;
var m_document_removeEventListener = document.removeEventListener;
var m_window_addEventListener = window.addEventListener;
var m_window_removeEventListener = window.removeEventListener;

/**
 * Houses custom event handlers to intercept on document + window event listeners.
 */
var documentEventHandlers = {},
    windowEventHandlers = {};

document.addEventListener = function(evt, handler, capture) {
    var e = evt.toLowerCase();
    if (typeof documentEventHandlers[e] != 'undefined') {
        documentEventHandlers[e].subscribe(handler);
    } else {
        m_document_addEventListener.call(document, evt, handler, capture);
    }
};

window.addEventListener = function(evt, handler, capture) {
    var e = evt.toLowerCase();
    if (typeof windowEventHandlers[e] != 'undefined') {
        windowEventHandlers[e].subscribe(handler);
    } else {
        m_window_addEventListener.call(window, evt, handler, capture);
    }
};

document.removeEventListener = function(evt, handler, capture) {
    var e = evt.toLowerCase();
    // If unsubscribing from an event that is handled by a plugin
    if (typeof documentEventHandlers[e] != "undefined") {
        documentEventHandlers[e].unsubscribe(handler);
    } else {
        m_document_removeEventListener.call(document, evt, handler, capture);
    }
};

window.removeEventListener = function(evt, handler, capture) {
    var e = evt.toLowerCase();
    // If unsubscribing from an event that is handled by a plugin
    if (typeof windowEventHandlers[e] != "undefined") {
        windowEventHandlers[e].unsubscribe(handler);
    } else {
        m_window_removeEventListener.call(window, evt, handler, capture);
    }
};

function createEvent(type, data) {
    var event = document.createEvent('Events');
    event.initEvent(type, false, false);
    if (data) {
        for (var i in data) {
            if (data.hasOwnProperty(i)) {
                event[i] = data[i];
            }
        }
    }
    return event;
}


var cordova = {
    define:define,
    require:require,
    version:PLATFORM_VERSION_BUILD_LABEL,
    platformVersion:PLATFORM_VERSION_BUILD_LABEL,
    platformId:platform.id,
    /**
     * Methods to add/remove your own addEventListener hijacking on document + window.
     */
    addWindowEventHandler:function(event) {
        return (windowEventHandlers[event] = channel.create(event));
    },
    addStickyDocumentEventHandler:function(event) {
        return (documentEventHandlers[event] = channel.createSticky(event));
    },
    addDocumentEventHandler:function(event) {
        return (documentEventHandlers[event] = channel.create(event));
    },
    removeWindowEventHandler:function(event) {
        delete windowEventHandlers[event];
    },
    removeDocumentEventHandler:function(event) {
        delete documentEventHandlers[event];
    },
    /**
     * Retrieve original event handlers that were replaced by Cordova
     *
     * @return object
     */
    getOriginalHandlers: function() {
        return {'document': {'addEventListener': m_document_addEventListener, 'removeEventListener': m_document_removeEventListener},
        'window': {'addEventListener': m_window_addEventListener, 'removeEventListener': m_window_removeEventListener}};
    },
    /**
     * Method to fire event from native code
     * bNoDetach is required for events which cause an exception which needs to be caught in native code
     */
    fireDocumentEvent: function(type, data, bNoDetach) {
        var evt = createEvent(type, data);
        if (typeof documentEventHandlers[type] != 'undefined') {
            if( bNoDetach ) {
                documentEventHandlers[type].fire(evt);
            }
            else {
                setTimeout(function() {
                    // Fire deviceready on listeners that were registered before cordova.js was loaded.
                    if (type == 'deviceready') {
                        document.dispatchEvent(evt);
                    }
                    documentEventHandlers[type].fire(evt);
                }, 0);
            }
        } else {
            document.dispatchEvent(evt);
        }
    },
    fireWindowEvent: function(type, data) {
        var evt = createEvent(type,data);
        if (typeof windowEventHandlers[type] != 'undefined') {
            setTimeout(function() {
                windowEventHandlers[type].fire(evt);
            }, 0);
        } else {
            window.dispatchEvent(evt);
        }
    },

    /**
     * Plugin callback mechanism.
     */
    // Randomize the starting callbackId to avoid collisions after refreshing or navigating.
    // This way, it's very unlikely that any new callback would get the same callbackId as an old callback.
    callbackId: Math.floor(Math.random() * 2000000000),
    callbacks:  {},
    callbackStatus: {
        NO_RESULT: 0,
        OK: 1,
        CLASS_NOT_FOUND_EXCEPTION: 2,
        ILLEGAL_ACCESS_EXCEPTION: 3,
        INSTANTIATION_EXCEPTION: 4,
        MALFORMED_URL_EXCEPTION: 5,
        IO_EXCEPTION: 6,
        INVALID_ACTION: 7,
        JSON_EXCEPTION: 8,
        ERROR: 9
    },

    /**
     * Called by native code when returning successful result from an action.
     */
    callbackSuccess: function(callbackId, args) {
        cordova.callbackFromNative(callbackId, true, args.status, [args.message], args.keepCallback);
    },

    /**
     * Called by native code when returning error result from an action.
     */
    callbackError: function(callbackId, args) {
        // TODO: Deprecate callbackSuccess and callbackError in favour of callbackFromNative.
        // Derive success from status.
        cordova.callbackFromNative(callbackId, false, args.status, [args.message], args.keepCallback);
    },

    /**
     * Called by native code when returning the result from an action.
     */
    callbackFromNative: function(callbackId, isSuccess, status, args, keepCallback) {
        try {
            var callback = cordova.callbacks[callbackId];
            if (callback) {
                if (isSuccess && status == cordova.callbackStatus.OK) {
                    callback.success && callback.success.apply(null, args);
                } else if (!isSuccess) {
                    callback.fail && callback.fail.apply(null, args);
                }
                /*
                else
                    Note, this case is intentionally not caught.
                    this can happen if isSuccess is true, but callbackStatus is NO_RESULT
                    which is used to remove a callback from the list without calling the callbacks
                    typically keepCallback is false in this case
                */
                // Clear callback if not expecting any more results
                if (!keepCallback) {
                    delete cordova.callbacks[callbackId];
                }
            }
        }
        catch (err) {
            var msg = "Error in " + (isSuccess ? "Success" : "Error") + " callbackId: " + callbackId + " : " + err;
            console && console.log && console.log(msg);
            cordova.fireWindowEvent("cordovacallbackerror", { 'message': msg });
            throw err;
        }
    },
    addConstructor: function(func) {
        channel.onCordovaReady.subscribe(function() {
            try {
                func();
            } catch(e) {
                console.log("Failed to run constructor: " + e);
            }
        });
    }
};


module.exports = cordova;
        </script>
        <link rel="stylesheet" href="JQ/jquery.mobile-1.4.2.min.css" />
    <script src="JQ/jquery-2.1.1.min.js"></script>
    <script src="JQ/jquery.mobile-1.4.2.min.js"></script>
        <script src="https://maps.googleapis.com/maps/api/js?v=3.exp&sensor=false"></script>
        <script>
          $( document ).on( "pageinit", "#paginaMapa", function(e,data) {
        
        var defaultPos = new google.maps.LatLng(19.289168, -99.653440);
        
        if (navigator.geolocation) {
                    function exito(pos) {
                        MuestraMapa(new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude));
             
                      }
            function falla(error) {
            //si falla mostrar mpara en posicion por defecto
              alert('Error en servicio Geolocalizador');
              MuestraMapa(defaultPos); 
            }
            
          //maximumAge- Guarda la posicion por 5 minutos 
          //enableHighAccuracy: Se tratan de obtener los mejores resultados posible del GPS
          //timeout: el tiempo maximo que se espera para obtener la posicion en este caso 5 segundos
            var options = {maximumAge: 500000, enableHighAccuracy:true, timeout: 5000};
            navigator.geolocation.getCurrentPosition(exito, falla, options );
          }//FIN IF
          else {
                    MuestraMapa(defaultPos);  // No soporta geolocalizacion y dibuja el mapa en posicion Default
                   }
           
           //FUNCION DIBUJAR MAPa
           function MuestraMapa(latlng) {
            
            var myOptions = {
                        zoom: 16,
                        center: latlng,
            disableDefaultUI: true,
                        mapTypeId: google.maps.MapTypeId.ROADMAP};
            
            var map = new google.maps.Map(document.getElementById("map-canvas"), myOptions);
            var infowindow = new google.maps.InfoWindow({
                                  position: latlng,
                                  content: '<p>Tu posición actual</p>'+latlng
                  });
            
            var marker = new google.maps.Marker({
              position: latlng,
              map: map,
              title: "Mi posición",
              animation: google.maps.Animation.DROP
                      });
            google.maps.event.addListener(marker, 'click', function() {infowindow.open(map,marker);});
             
           }// Fin muestra mapa
        
        });
        </script>
        <style>
      #map-canvas{
          height:100%;
          width:100%;
          padding:0;
          position:absolute !important;
          top:40px;
          righ:0px;
          bottom:0px !important;
          left:0px !important;
        }
    </style>