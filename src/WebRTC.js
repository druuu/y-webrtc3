function extend (Y) {

var USE_AUDIO = true;
var USE_VIDEO = true;
var DEFAULT_CHANNEL = 'some-global-channel-name';
var MUTE_AUDIO_BY_DEFAULT = false;
var signaling_server_url = 'http://finwin.io:1256';

var ICE_SERVERS = [
    {urls: "stun:stun.l.google.com:19302"},
    {urls: "turn:try.refactored.ai:3478", username: "test99", credential: "test"}
];


var dcs = {};
var signaling_socket = null;   /* our socket.io connection to our webserver */
var local_media_stream = null; /* our own microphone / webcam */
var peers = {};                /* keep track of our peer connections, indexed by peer_id (aka socket.io id) */
var peer_media_elements = {};  /* keep track of our <video>/<audio> tags, indexed by peer_id */
var is_first = 'unknown';

function init(ywebrtc) {
    signaling_socket = io.connect(signaling_server_url);

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
        ywebrtc.setUserId(signaling_socket.id);
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
    function part_chat_channel(channel) {
        signaling_socket.emit('part', channel);
    }


    signaling_socket.on('addPeer', function(config) {
        var peer_id = config.peer_id;

        ywebrtc.userJoined(peer_id, 'master');

        if (peer_id in peers) {
            /* This could happen if the user joins multiple channels where the other peer is also in. */
            return;
        }

        var peer_connection = new RTCPeerConnection({"iceServers": ICE_SERVERS});
        peers[peer_id] = peer_connection;
        var dataChannel = peer_connection.createDataChannel('data');
        dcs[peer_id] = dataChannel;
        dataChannel.onmessage = function(e) {
            console.log(e);
            ywebrtc.receiveMessage(peer_id, JSON.parse(e.data));
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
            dataChannel.onmessage = function(e) {
                console.log(e);
                ywebrtc.receiveMessage(peer_id, JSON.parse(e.data));
            };
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


  class WebRTC extends Y.AbstractConnector {
    constructor (y, options) {
      if (options === undefined) {
        throw new Error('Options must not be undefined!')
      }
      if (options.room == null) {
        throw new Error('You must define a room name!')
      }
      options.role = 'slave'
      super(y, options)
      this.webrtcOptions = {
        url: options.url,
        room: options.room
      }
      var ywebrtc = this;
      init(ywebrtc);
      var swr = signaling_socket;
      this.swr = swr;
    }
    disconnect () {
      console.log('implement disconnect of channel');
      super.disconnect()
    }
    reconnect () {
      console.log('implement reconnect of channel');
      super.reconnect()
    }
    send (uid, message) {
        var self = this
        var send = function () {
            var dc = dcs[uid];
            if (dc.readyState === 'open') {
                dc.send(JSON.stringify(message));
            }
            else {
                setTimeout(send, 500)
            }
        }
        // try to send the message
        send()
    }
    broadcast (message) {
        for (var peer_id in dcs) {
            var dc = dcs[peer_id];
            if (dc.readyState === 'open') {
                dc.send(JSON.stringify(message));
            }
            else {
                console.log('Errrrrrrrrrrrrrrrrrrrrrrrrrrrrrr', peer_id);
            }
        }
    }
    isDisconnected () {
      return false
    }
  }
  Y.extend('webrtc', WebRTC)
}

module.exports = extend
if (typeof Y !== 'undefined') {
  extend(Y)
}
