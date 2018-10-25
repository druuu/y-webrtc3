import io from 'socket.io-client'

export default function extend(Y) {
    class Connector extends Y.AbstractConnector {
        constructor(y, options) {
            if (options === undefined) {
                throw new Error('Options must not be undefined!')
            }
            options.preferUntransformed = true
            options.generateUserId = options.generateUserId || false
            if (options.initSync !== false) {
                options.initSync = true
            }
            super(y, options)
            this._sentSync = false
            this.options = options
            options.url = options.url || 'https://yjs.dbis.rwth-aachen.de:5072'
            var socket = options.socket || io(options.url, options.options)
            this.socket = socket
            var self = this

            /****************** start minimal webrtc **********************/
            var signaling_socket = socket;
            var ICE_SERVERS = [
                {urls: "stun:stun.l.google.com:19302"},
                {urls: "turn:try.refactored.ai:3478", username: "test99", credential: "test"}
            ];
            var dcs = {};
            var sdcs = {};
            this.dcs = dcs;
            this.sdcs = dcs;
            //dcs2: user datachannel
            this.dcs2 = {};
            var local_media_stream = null;
            var peers = {};
            var peer_media_elements = {};
            var sockets;
            this.sockets = sockets;
            this.markers = {};

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

            function get_cell(id) {
                var cells = Jupyter.notebook.get_cells();
                for (var i = 0; i < cells.length; i++) {
                    if (cells[i].id === id) {
                        return cells[i];
                    }
                }
            }

            function receiveData2(ywebrtc, peer_id) {
                return function onmessage(event) {
                    var data = JSON.parse(event.data);
                    var cm = get_cell(data.id).code_mirror;
                    var cursorCoords = cm.cursorCoords(data);
                    var cursorElement = document.createElement('span');
                    cursorElement.style.borderLeftStyle = 'solid';
                    cursorElement.style.borderLeftWidth = '2px';
                    cursorElement.style.borderLeftColor = '#ff0000';
                    cursorElement.style.height = cursorCoords.bottom - cursorCoords.top + 'px';
                    cursorElement.style.padding = 0;
                    cursorElement.style.zIndex = 0;
                    var id = peer_id + data.id;
                    if (ywebrtc.markers[id]) {
                        ywebrtc.markers[id].clear();
                    }
                    ywebrtc.markers[id] = cm.setBookmark(data, { widget: cursorElement });
                };
            }

            function init(ywebrtc) {
                signaling_socket.on('connect', function() {
                    join_chat_channel(ywebrtc.options.room, {'whatever-you-want-here': 'stuff'});
                });
            
                signaling_socket.on('sockets', function (sockets) {
                    window.sockets = sockets;
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
                }

                function part_chat_channel(channel) {
                    signaling_socket.emit('part', channel);
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
                    //datachannel2: user data datachannel
                    //data3: user data
                    var dataChannel2 = peer_connection.createDataChannel('data3');

                    dataChannel.binaryType = 'arraybuffer';
                    syncDataChannel.binaryType = 'arraybuffer';
                    dataChannel2.binaryType = 'arraybuffer';

                    ywebrtc.dcs[peer_id] = dataChannel;
                    ywebrtc.sdcs[peer_id] = syncDataChannel;
                    ywebrtc.dcs2[peer_id] = dataChannel2;

                    ywebrtc.userJoined(peer_id, 'master');

	                dataChannel.onmessage = receiveData(ywebrtc, peer_id);
	                syncDataChannel.onmessage = function (e) {
	                    ywebrtc.receivebuffer(peer_id, e.data);
	                };
	                dataChannel2.onmessage = receiveData2(ywebrtc, peer_id);;

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
                    }
            
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
                            dataChannel.onmessage = receiveData2(ywebrtc, peer_id);
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
        }

        disconnect() {
        }
        destroy() {
        }
        reconnect() {
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
    Connector.io = io
    Y['webrtc'] = Connector
}

if (typeof Y !== 'undefined') {
    extend(Y) // eslint-disable-line
}
