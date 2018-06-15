
/**
 * y-webrtc3 - 
 * @version v2.1.0
 * @license MIT
 */

'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var io = _interopDefault(require('socket.io-client'));

function extend(Y) {
    class Connector extends Y.AbstractConnector {
        constructor(y, options) {
            if (options === undefined) {
                throw new Error('Options must not be undefined!')
            }
            options.preferUntransformed = true;
            options.generateUserId = options.generateUserId || false;
            if (options.initSync !== false) {
                options.initSync = true;
            }
            super(y, options);
            this._sentSync = false;
            this.options = options;
            options.url = options.url || 'https://yjs.dbis.rwth-aachen.de:5072';
            var socket = options.socket || io(options.url, options.options);
            this.socket = socket;
            var self = this;

            /****************** start minimal webrtc **********************/
            var signaling_socket = socket;
            var DEFAULT_CHANNEL = 'dinesh';
            var ICE_SERVERS = [
                {urls: "stun:stun.l.google.com:19302"},
                {urls: "turn:try.refactored.ai:3478", username: "test99", credential: "test"}
            ];
            var dcs = {};
            this.dcs = dcs;
            this.sdcs = dcs;
            var peers = {};
            var peer_media_elements = {};
            var is_first = 'unknown';
            

	        function receiveData(ywebrtc, peer_id) {
	            var buf, count;
	            return function onmessage(event) {
	                if (typeof event.data === 'string') {
	                    buf = new Uint8Array(parseInt(event.data));
	                    count = 0;
	                    return;
	                }
	                var data = new Uint8Array(event.data);
	                buf.set(data, count);
	                count += data.byteLength;
	                if (count === buf.byteLength) {
	                    ywebrtc.receiveMessage(peer_id, buf);
	                }
	            };
	        }

            function init(ywebrtc) {
                signaling_socket.on('connect', function() {
                    join_chat_channel(DEFAULT_CHANNEL, {'whatever-you-want-here': 'stuff'});
                });
            
                signaling_socket.on('sockets', function (sockets) {
                    if (sockets === 0) {
                        is_first = true;
                    }
                    else {
                        is_first = false;
                    }
                });
            
                signaling_socket.on('disconnect', function() {
                    /* Tear down all of our peer connections and remove all the
                     * media divs when we disconnect */
                    for (peer_id in peer_media_elements) {
                        peer_media_elements[peer_id].remove();
                    }
                    for (peer_id in peers) {
                        peers[peer_id].close();
                    }
            
                    peers = {};
                    peer_media_elements = {};
                });
                function join_chat_channel(channel, userdata) {
                    signaling_socket.emit('join', {"channel": channel, "userdata": userdata});
                    ywebrtc.userID = signaling_socket.id;
                    function load_notebook2(file_name) {
                        if (typeof Jupyter !== 'undefined'){
                            if (Jupyter.notebook) {
                                if (file_name === 'Untitled.ipynb') {
                                    Jupyter.notebook.load_notebook(file_name);
                                } else {
                                    Jupyter.notebook.load_notebook2(file_name);
                                }
                            }
                            else {
                                setTimeout(load_notebook2, 500, file_name);
                            }
                        }
                        else {
                            setTimeout(load_notebook2, 500, file_name);
                        }
                    }
                    function initialize_data() {
                        if (is_first === true) {
                            load_notebook2('Untitled.ipynb');
                        } else if (is_first === false) {
                            load_notebook2('template.ipynb');
                        } else {
                            setTimeout(initialize_data, 500);
                        }
                    }
                    initialize_data();
                }
            
            
                signaling_socket.on('addPeer', function(config) {
                    var peer_id = config.peer_id;
            
                    if (peer_id in peers) {
                        /* This could happen if the user joins multiple channels where the other peer is also in. */
                        return;
                    }
            
                    var peer_connection = new RTCPeerConnection({"iceServers": ICE_SERVERS});
                    peers[peer_id] = peer_connection;

                    var dataChannel = peer_connection.createDataChannel('data');
                    var syncDataChannel = peer_connection.createDataChannel('sync_data');

                    dataChannel.binaryType = 'arraybuffer';
                    syncDataChannel.binaryType = 'arraybuffer';

                    ywebrtc.dcs[peer_id] = dataChannel;
                    ywebrtc.sdcs[peer_id] = syncDataChannel;

                    ywebrtc.userJoined(peer_id, 'master');

	                dataChannel.onmessage = receiveData(ywebrtc, peer_id);
	                syncDataChannel.onmessage = function (e) {
	                    ywebrtc.receivebuffer(peer_id, e.data);
	                };

                    peer_connection.onicecandidate = function(event) {
                        if (event.candidate) {
                            signaling_socket.emit('relayICECandidate', {
                                'peer_id': peer_id, 
                                'ice_candidate': {
                                    'sdpMLineIndex': event.candidate.sdpMLineIndex,
                                    'candidate': event.candidate.candidate
                                }
                            });
                        }
                    };
            
                    if (config.should_create_offer) {
                        peer_connection.createOffer(
                            function (local_description) { 
                                peer_connection.setLocalDescription(local_description,
                                    function() { 
                                        signaling_socket.emit('relaySessionDescription', 
                                            {'peer_id': peer_id, 'session_description': local_description});
                                    },
                                    function() { Alert("Offer setLocalDescription failed!"); }
                                );
                            },
                            function (error) {
                                console.log("Error sending offer: ", error);
                            });
                    }
                });
            
            
                /** 
                 * Peers exchange session descriptions which contains information
                 * about their audio / video settings and that sort of stuff. First
                 * the 'offerer' sends a description to the 'answerer' (with type
                 * "offer"), then the answerer sends one back (with type "answer").  
                 */
                signaling_socket.on('sessionDescription', function(config) {
                    var peer_id = config.peer_id;
                    var peer = peers[peer_id];
            
                    peer.ondatachannel = function (event) {
                        var dataChannel = event.channel;
                        dataChannel.binaryType = 'arraybuffer';
                        if (dataChannel.label == 'sync_data') {
	                        dataChannel.onmessage = receiveData(ywebrtc, peer_id);
                        } else {
	                        dataChannel.onmessage = function (e) {
	                            ywebrtc.receivebuffer(peer_id, e.data);
	                        };
                        }
                    };
            
                    var remote_description = config.session_description;
            
                    var desc = new RTCSessionDescription(remote_description);
                    var stuff = peer.setRemoteDescription(desc, 
                        function() {
                            if (remote_description.type == "offer") {
                                peer.createAnswer(
                                    function(local_description) {
                                        peer.setLocalDescription(local_description,
                                            function() { 
                                                signaling_socket.emit('relaySessionDescription', 
                                                    {'peer_id': peer_id, 'session_description': local_description});
                                            },
                                            function() { Alert("Answer setLocalDescription failed!"); }
                                        );
                                    },
                                    function(error) {
                                        console.log("Error creating answer: ", error);
                                    });
                            }
                        },
                        function(error) {
                            console.log("setRemoteDescription error: ", error);
                        }
                    );
            
                });
            
                signaling_socket.on('iceCandidate', function(config) {
                    var peer = peers[config.peer_id];
                    var ice_candidate = config.ice_candidate;
                    peer.addIceCandidate(new RTCIceCandidate(ice_candidate));
                });
            
            
                signaling_socket.on('removePeer', function(config) {
                    var peer_id = config.peer_id;
                    ywebrtc.userLeft(peer_id);
                    if (peer_id in peer_media_elements) {
                        peer_media_elements[peer_id].remove();
                    }
                    if (peer_id in peers) {
                        peers[peer_id].close();
                    }
            
                    delete peers[peer_id];
                    delete peer_media_elements[config.peer_id];
                });
            }
            init(self);
            /************************ end minimal_webrtc ****************************/

            //this._onConnect = function () {
            //    if (options.initSync) {
            //        if (options.room == null) {
            //            throw new Error('You must define a room name!')
            //        }
            //        self._sentSync = true
            //        // only sync with server when connect = true
            //        //socket.emit('joinRoom', options.room)
            //        //self.userJoined('server', 'master')
            //        //self.connections.get('server').syncStep2.promise.then(() => {
            //        //    // set user id when synced with server
            //        //    self.setUserId(Y.utils.generateUserId())
            //        //})
            //    }
            //    socket.on('yjsEvent', self._onYjsEvent)
            //    socket.on('disconnect', self._onDisconnect)
            //}

            //socket.on('connect', this._onConnect)
            //if (socket.connected) {
            //    this._onConnect()
            //} else {
            //    socket.connect()
            //}

            //this._onYjsEvent = function (buffer) {
            //    //let decoder = new Y.utils.BinaryDecoder(buffer)
            //    //let roomname = decoder.readVarString()
            //    //if (roomname === options.room) {
            //    //    self.receiveMessage('server', buffer)
            //    //}
            //}

            //this._onDisconnect = function (peer) {
            //    Y.AbstractConnector.prototype.disconnect.call(self)
            //}
        }

        /*
         * Call this if you set options.initSync = false. Yjs will sync with the server after calling this method.
         */
        //initSync(opts) {
        //    if (!this.options.initSync) {
        //        this.options.initSync = true
        //        if (opts.room != null) {
        //            this.options.room = opts.room
        //        }
        //    }
        //    if (this.socket.connected) {
        //        this._onConnect()
        //    }
        //}

        disconnect() {
            //this.socket.emit('leaveRoom', this.options.room)
            //if (!this.options.socket) {
            //    this.socket.disconnect()
            //}
            //super.disconnect()
        }
        destroy() {
            //this.disconnect()
            //this.socket.off('disconnect', this._onDisconnect)
            //this.socket.off('yjsEvent', this._onYjsEvent)
            //this.socket.off('connect', this._onConnect)
            //if (!this.options.socket) {
            //    this.socket.destroy()
            //}
            //this.socket = null
        }
        reconnect() {
            //this.socket.connect()
            //super.reconnect()
        }

        send(uid, message) {
            console.log('$$$$$$$$$$$$$$$$ syncing...... $$$$$$$$$$$$$$$$$') ;
            function send2(dataChannel, data2) {
                if (dataChannel.readyState === 'open') {
                    var CHUNK_LEN = 64000;
                    var len = data2.byteLength;
                    var n = len / CHUNK_LEN | 0;
                    dataChannel.send(len);
                    // split the photo and send in chunks of about 64KB
                    for (var i = 0; i < n; i++) {
                        var start = i * CHUNK_LEN,
                            end = (i + 1) * CHUNK_LEN;
                        dataChannel.send(data2.subarray(start, end));
                    }
                    // send the reminder, if any
                    if (len % CHUNK_LEN) {
                        dataChannel.send(data2.subarray(n * CHUNK_LEN));
                    }
                } else {
                    setTimeout(send2, 500, dataChannel, data2);
                }
            }
            send2(this.sdcs[uid], new Uint8Array(message));
        }

        broadcast(message) {
            for (var peer_id in this.dcs) {
                function send2(dataChannel, data2) {
                    if (dataChannel.readyState === 'open') {
                        var CHUNK_LEN = 64000;
                        var len = data2.byteLength;
                        var n = len / CHUNK_LEN | 0;
                        dataChannel.send(len);
                        // split the photo and send in chunks of about 64KB
                        for (var i = 0; i < n; i++) {
                            var start = i * CHUNK_LEN,
                                end = (i + 1) * CHUNK_LEN;
                            dataChannel.send(data2.subarray(start, end));
                        }
                        // send the reminder, if any
                        if (len % CHUNK_LEN) {
                            dataChannel.send(data2.subarray(n * CHUNK_LEN));
                        }
                    } else {
                        console.log('Errrrrrrrrrrrrrrrrrrrrrrrrrrrrrr', peer_id);
                    }
                }
                send2(this.dcs[peer_id], new Uint8Array(message));
            }
        }

        isDisconnected() {
            return this.socket.disconnected
        }
    }
    Connector.io = io;
    Y['webrtc'] = Connector;
    // Y.extend('websockets-client', Connector)
}

if (typeof Y !== 'undefined') {
    extend(Y); // eslint-disable-line
}

module.exports = extend;
//# sourceMappingURL=y-webrtc.node.js.map