const voice1 = document.getElementById("voice1");


const mediasoup = require('mediasoup-client')
const socketClient = require('socket.io-client');
const socketPromise = require('./lib/socket.io-promise').promise;

let device
let socket
let producer
let connectedProducerIds = [];
let audioEnabled = false;

const opts = {
	path: '/server',
	transports: ['websocket'],
};

const hostname = window.location.hostname;
const serverUrl = `http://${hostname}:${3000}`;
socket = socketClient(serverUrl, opts);
socket.request = socketPromise(socket);


function connectToServer() {
	socket.on('connect', async () => {
		console.log("Connected to the server with id = " + socket.id)

		const data = await socket.request('getRouterRtpCapabilities');
		await loadDevice(data);

	});

	socket.on('newProducer', async (producerId) => {
		console.log("Producer available id = " + producerId)
		const newElem = document.createElement('div')
		newElem.setAttribute('id', `td-${producerId}`)

		//append to the audio container
		newElem.innerHTML = '<p id="p' + producerId + '" >' + producerId + '</p>'
		participantContainer.appendChild(newElem)
		document.getElementById('p' + producerId)

		subscribe(producerId)

	});

	socket.on('newChannelProducer', async (producerId) => {
		console.log("Producer available id = " + producerId)
		subcribeToDataChannel(producerId)
		//subscribe( producerId )

	});

	socket.on('producerClosed', id => {
		console.log("Producer closed event fired")

		document.getElementById("p" + id).innerHTML = '';
	});
}



async function loadDevice(routerRtpCapabilities) {
	try {
		device = new mediasoup.Device();
	} catch (error) {
		if (error.name === 'UnsupportedError') {
			console.error('browser not supported');
		}
	}
	await device.load({ routerRtpCapabilities });
}

async function publish(_e) {

	// initializeDataChannel();
	const data = await socket.request('createProducerTransport', {
		forceTcp: false,
		rtpCapabilities: device.rtpCapabilities,
		sctpCapabilities: device.sctpCapabilities,
	});
	if (data.error) {
		console.error(data.error);
		return;
	}

	const transport = device.createSendTransport({
		...data, iceServers: [{
			'urls': 'stun:stun1.l.google.com:19302'
		}]
	});
	transport.on('connect', async ({ dtlsParameters, sctpParameters }, callback, errback) => {
		socket.request('connectProducerTransport', { dtlsParameters, sctpParameters })
			.then(callback)
			.catch(errback);
	});

	transport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
		console.log("Produce emitted for audio transport")
		try {
			const { id, producersExist } = await socket.request('produce', {
				transportId: transport.id,
				kind,
				rtpParameters,
			});
			console.log("Producers exists on the server: " + producersExist)
			audioEnabled = true
			if (producersExist) {
				getProducers()
			}
			callback({ id });
		} catch (err) {
			errback(err);
		}
	});

	transport.on('connectionstatechange', (state) => {
		switch (state) {
			case 'connecting':
				console.log("Connecting to publish")
				break;


			case 'connected':
				console.log("Connected")
				break;

			case 'failed':
				transport.close();
				console.log("Failed connection")
				break;

			default: break;
		}
	});


	const mediaConstraints = {
		audio: true,
		video: false
	}

	try {
		navigator.mediaDevices.getUserMedia(mediaConstraints).then((stream) => {
			const newElem = document.createElement('div')
			newElem.setAttribute('id', `localAudio`)

			//append to the audio container
			newElem.innerHTML = '<audio id="localAudio" autoplay></audio>'

			videoContainer.appendChild(newElem)
			document.getElementById("localAudio").srcObject = stream;
			const track = stream.getAudioTracks()[0];
			let params = { track };

			params.codecOptions = {
				opusStereo: 1,
				opusDtx: 1
			}
			producer = transport.produce(params);
		})
	} catch (err) {
		alert(err);
	}
}

function closeProducer() {
	if (audioEnabled) {
		producer.then((produce) => {
			console.log("CLOSING PRODUCER")
			let id = produce.id;
			socket.request('producerClose', { id });
			produce.close()
		})
	}
	//initializeDataChannel()
}

async function subscribe(remoteProducerId) {
	console.log("Subscribing to the producer for audio = " + remoteProducerId)
	const data = await socket.request('createConsumerTransport', {
		forceTcp: false,
		rtpCapabilities: device.rtpCapabilities,
		sctpCapabilities: device.sctpCapabilities,
	});
	if (data.error) {
		console.error(data.error);
		return;
	}
	console.log("Created consumer transport with id")

	const transport = device.createRecvTransport({
		...data, iceServers: [{
			'urls': 'stun:stun1.l.google.com:19302'
		}]
	});

	transport.on('connect', ({ dtlsParameters }, callback, errback) => {
		console.log("Connected to the transport")
		socket.request('connectConsumerTransport', {
			transportId: transport.id,
			dtlsParameters
		})
			.then(callback)
			.catch(errback);
	});

	transport.on('connectionstatechange', async (state) => {
		switch (state) {
			case 'connecting':
				console.log("Connecting to consumer for audio, transport id: " + transport.id)
				break;

			case 'connected':
				//document.querySelector('#remoteVideo').srcObject = await stream;
				// create a new div element for the new consumer media
				const newElem = document.createElement('div')
				newElem.setAttribute('id', `td-${remoteProducerId}`)

				//append to the audio container
				newElem.innerHTML = '<audio id="' + remoteProducerId + '" autoplay></audio>'

				videoContainer.appendChild(newElem)
				document.getElementById(remoteProducerId).srcObject = await stream;

				//await socket.request('resume');
				console.log("Connected to consumer for audio, transport id: " + transport.id)
				break;

			case 'failed':
				transport.close();
				console.log("Consumer failed")
				break;

			default: break;
		}
	});
	console.log("REMOTE PRODUCER ID = " + remoteProducerId)
	const stream = consume(transport, remoteProducerId)
}




function getProducers() {
	socket.emit('getProducers', producerIds => {
		// for each of the producer create a consumer
		// producerIds.forEach(id => signalNewConsumerTransport(id))
		producerIds.forEach(id => {
			if (id[1] == true) {
				console.log("DATA CHANNEL PRODUCER")

				if (!connectedProducerIds.includes(id[0])) {
					subcribeToDataChannel(id[0])
				}
			}
			else if (id[1] == false && audioEnabled) {
				subscribe(id[0])
				const newElem = document.createElement('div')
				newElem.setAttribute('id', `td-${id[0]}`)

				//append to the audio container
				newElem.innerHTML = '<p id="p' + id[0] + '" >' + id[0] + '</p>'

				participantContainer.appendChild(newElem)
				document.getElementById('p' + id[0])
			}

		})
	})
}
async function consume(transport, remoteProducerId) {
	const { rtpCapabilities } = device;
	const transportId = transport.id;

	console.log("Consume called for audio conference")
	const data = await socket.request('consume', { rtpCapabilities, remoteProducerId, transportId, dataChannel: false });
	const {
		producerId,
		id,
		kind,
		rtpParameters,
	} = data;

	let codecOptions = {};
	const consumer = await transport.consume({
		id,
		producerId,
		kind,
		rtpParameters,
		codecOptions,
	});
	const stream = new MediaStream();
	stream.addTrack(consumer.track);
	return stream;
}




voice1.addEventListener("click", publish)
connectToServer()


closeToggle.addEventListener("click", () => {
	closeProducer();
	if (audioEnabled) {
		const stream = document.getElementById("localAudio").srcObject;
		stream.getTracks().forEach(function(track) {
			track.stop();
		});
	}
	audioEnabled = false;

	document.getElementById("participantContainer").innerHTML = '';
})


