// Dependencies
var express	= require ('express');
	fs		= require ('fs');
	https	= require ('https');
	_			= require ('lodash');


// Initialise variables for server
var app		= express();

// Initialise variables for api handling
var onionRestHostname 	= 'api.onion.io';
	omegaDbFile = 'omegas.json';
	omegaConfigList = [];
	safeOmegaDataList = [];

const EventEmitter = require('events');
class ResponseEmitter extends EventEmitter {}
const omegaUpdateResponse = new ResponseEmitter ();

// set up response handlers
omegaUpdateResponse.on ('success', (deviceId, data) => {
	console.log ('omegaUpdateResponse emit temp update' + data.code);
//	temp = parseAS6200 (data.stdout);
	temp = data.stdout.split('\n')[0];
	updateOmega (deviceId, temp, null, data.code);
});

omegaUpdateResponse.on ('failure', (deviceId, data) => {
	console.log ('omegaUpdateResponse emit error ' + data.statusCode);
	updateOmega (deviceId, null, data.message, data.statusCode);
});


function parseAS6200 (stdout)
{
	rawTemp = stdout.slice(2,6);
	bytesTemp = rawTemp.substr(2,2) + rawTemp.substr(0,2);
	longBinTemp = parseInt(bytesTemp, 16)
	binTemp = longBinTemp >> 4;
	if (binTemp > 1600)
	{	//dirty bit level math
		binTemp = binTemp - 4096;
	}
	temp = binTemp * 0.0625;

	return temp;
}


// Checks for existing omega to update, does nothing if no omega found with given ID
function updateOmega (deviceId, temp, message, statusCode)
{
	// check if existing device
	safeOmegaDataList.forEach (function (omega) {
		if (omega.deviceId == deviceId) {
			omega.statusCode = statusCode;
			omega.temp = temp;
			omega.message = message;
			omega.time =  new Date();
			console.log ('Updating omega with ID: ' + deviceId + '| Code ' + statusCode + ': ' + omega.message + ' ' + omega.temp);
			return true;
		}
	});

	return false
}

// for future use
function addOmegaConfig (deviceId, apiKey, sensorCommand, displayName, deviceLocation)
{
	omegaConfig = {
		"deviceId" : deviceId,
		"apiKey" : apiKey,
		"sensorCommand" : sensorCommand,
		"displayName" : displayName,
		"deviceLocation" : deviceLocation || ''
	};

	omegaConfigList.push(omegaConfig);
	fs.writeFileSync('omegas.json', JSON.stringify(omegaConfigList, null, 4));
}

function initOmegaList ()
{
	omegaConfigList = JSON.parse (fs.readFileSync (omegaDbFile));
	omegaConfigList.forEach ( function (omegaConfig) {
		safeOmega = (JSON.parse (JSON.stringify (omegaConfig)));
		delete safeOmega.apiKey;
		delete safeOmega.sensorCommand;
		safeOmegaDataList.push(safeOmega);
	});
}

// Constructs an exec request header from a given Omega
function onionCloudDevRequest (omega, ep)
{
	endpoint = '/v1/devices/' + omega.deviceId + ep;
	options =
	{
		hostname: onionRestHostname,
		path	: endpoint,
		method	: 'POST',
		headers	:
		{
			"X-API-KEY"	: omega.apiKey,
		}
	};

	// actual requesting
	return https.request (options, (res) => {
	//		console.log ('request ' + i + ' called back');
			let rawData = '';

			res.on ('data', (chunk) => rawData += chunk);
			res.on ('end', () => {
				console.log ('response ended ' + omega.deviceId);

				let parsedData = {};

				try			{ parsedData = JSON.parse(rawData);	}
				catch (e)	{
					console.log ('Unable to parse rawData: ' + e.message);
					parsedData.message = 'Cloud response unreadable: ' + e.message;
					parsedData.statusCode = -1;
				}

				let responseEvent = 'failure';

				if (parsedData.code == 0)
				{ responseEvent = 'success'; }

				console.log ('response code: ' + parsedData.statusCode + ' | raw: ' + parsedData);
				console.log (parsedData);
				omegaUpdateResponse.emit (responseEvent, omega.deviceId, parsedData);

			});
		}).on ('error', (e) => {
			console.log('request ERROR ' + e.message);
		});
}

// Goes through the list of known Omegas and updates each one
function omegaTempUpdate(frontendResponse)
{
	console.log (omegaConfigList);

	// Interatively updating omegas
	omegaConfigList.forEach(function (omegaConfig) {
		command = omegaConfig.sensorCommand.split(" ");
		body = JSON.stringify (
				{
					"command"	: command[0],
					// body.params must be ARRAY!
					"params"	: command.slice(1)
				});
		// pass in the config, updates the safe list when the call returns
		req = onionCloudDevRequest (omegaConfig, '/file/exec');
		console.log(req.getHeader('X-API-KEY'));

		req.write(body);
		console.log('request wrote' + body);

		req.end();
		console.log('request ended');
	});

	if (frontendResponse != undefined) {
		frontendResponse.json(safeOmegaDataList);
		frontendResponse.end();
	}
}

// SERVER SETUP
app.use ('/', express.static('static'));

app.get('/data', function (req, res) {
	res.json(safeOmegaDataList);
});

app.post('/add', function (req, res) {
	var params = req.body;

	// ensure all required parameters are in the request
	if (_.has(params, 'deviceId') && _.has(params, 'apiKey') && _.has(params, 'sensorCommand') && _.has(displayName, 'deviceId') ) {
		// add to the config
		addOmegaConfig(params.deviceId, params.apiKey, params.sensorCommand, params.displayName, _.get(params, 'deviceLocation', ''));
		// respond with a success message
		res.json({
			device: params.deviceId,
			status: 'success'
		});
	} else {
		// respond with an error message
		res.status(400).json({
			error: 'Missing parameter'
		});
	}

});


var port = process.env.PORT || 8080;
var updateInterval = 60000;

app.listen (port, function () {
	// Loading the config list once
	console.log('Example app listening on port ' + port);
	initOmegaList();
	omegaTempUpdate();
	setInterval(function(){	omegaTempUpdate(); }, updateInterval);
});
