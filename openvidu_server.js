/* CONFIGURATION */

var OpenVidu = require('openvidu-node-client').OpenVidu;
var Session = require('openvidu-node-client').Session;
var OpenViduRole = require('openvidu-node-client').OpenViduRole;
var TokenOptions = require('openvidu-node-client').TokenOptions;

// Check launch arguments: must receive openvidu-server URL and the secret
if (process.argv.length != 4) {
    console.log("Usage: node " + __filename + " OPENVIDU_URL OPENVIDU_SECRET");
    process.exit(-1);
}
// For demo purposes we ignore self-signed certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

// Node imports
var express = require('express');
var fs = require('fs');
var session = require('express-session');
var http = require('http');
var https = require('https');
var bodyParser = require('body-parser'); // Pull information from HTML POST (express4)
var app = express(); // Create our app with express
var debug = true;

// Server configuration
app.use(session({
    saveUninitialized: true,
    resave: false,
    secret: 'MY_SECRET'
}));
app.use(express.static(__dirname + '/public')); // Set the static files location
app.use(bodyParser.urlencoded({
    'extended': 'true'
})); // Parse application/x-www-form-urlencoded
app.use(bodyParser.json()); // Parse application/json
app.use(bodyParser.json({
    type: 'application/vnd.api+json'
})); // Parse application/vnd.api+json as json

// Listen (start app with node server.js)
var options = {
    key: fs.readFileSync('keys/server.key'),
    cert: fs.readFileSync('keys/server.crt')
};
if(debug){
    http.createServer(app).listen(5000);
}else{
    https.createServer(options, app).listen(5000);
}


// Mock database
var users = [{
    user: "publisher1",
    pass: "pass",
    role: OpenViduRole.PUBLISHER
}, {
    user: "publisher2",
    pass: "pass",
    role: OpenViduRole.PUBLISHER
}, {
    user: "subscriber",
    pass: "pass",
    role: OpenViduRole.SUBSCRIBER
}];

// Environment variable: URL where our OpenVidu server is listening
var OPENVIDU_URL = process.argv[2];
// Environment variable: secret shared with our OpenVidu server
var OPENVIDU_SECRET = process.argv[3];

// Entrypoint to OpenVidu Node Client SDK
var OV = new OpenVidu(OPENVIDU_URL, OPENVIDU_SECRET);

// Collection to pair session names with OpenVidu Session objects
var mapSessions = {};
// Collection to pair session names with tokens
var mapSessionNamesTokens = {};

console.log("App listening on port 5000");

/* CONFIGURATION */



/* REST API */

// Login
app.post('/api-login/login', function (req, res) {

    console.log("login request ...."+req.session.id);

    var userId = req.body.userId;
    var userName = req.body.userName;

    req.session.loggedUser = {  userId: userId,
                                userName: userName,
                                role: OpenViduRole.PUBLISHER
                              };
    res.status(200).send();
});

// Logout
app.post('/api-login/logout', function (req, res) {
    console.log("'" + req.session.loggedUser + "' has logged out");
    req.session.destroy();
    res.status(200).send();
});

// Get token (add new user to session)
app.post('/api-sessions/get-token', function (req, res) {
    console.log("get-token request ...."+req.session.id);
    if (!isLogged(req.session)) {
        req.session.destroy();
        res.status(401).send('User not logged');
    } else {
        // The video-call to connect
        var sessionName = req.body.sessionName;

        // Role associated to this user
        var role = req.session.loggedUser.role;

        // Optional data to be passed to other users when this user connects to the video-call
        // In this case, a JSON with the value we stored in the req.session object on login
        var serverData = JSON.stringify({ serverData: req.session.loggedUser });

        console.log("Getting a token | {sessionName}={" + sessionName + "}");

        // Build tokenOptions object with the serverData and the role
        var tokenOptions = {
            data: serverData,
            role: role
        };

        if (mapSessions[sessionName]) {
            // Session already exists
            console.log('Existing session ' + sessionName);

            // Get the existing Session from the collection
            var mySession = mapSessions[sessionName];

            // Generate a new token asynchronously with the recently created tokenOptions
            mySession.generateToken(tokenOptions)
                .then(token => {
                    // Store the new token in the collection of tokens
                    mapSessionNamesTokens[sessionName].push(token);
                    // Return the token to the client
                    res.status(200).send({
                        0: token
                    });
                })
                .catch(error => {
                    console.error(error);
                    createSession(res,sessionName,tokenOptions);
                });
        } else {
            // New session
            console.log('New session ' + sessionName);
            // Create a new OpenVidu Session asynchronously
            createSession(res,sessionName,tokenOptions);
        }
    }
});

function createSession(res,sessionName,tokenOptions){
    OV.createSession()
        .then(session => {
            // Store the new Session in the collection of Sessions
            mapSessions[sessionName] = session;
            // Store a new empty array in the collection of tokens
            mapSessionNamesTokens[sessionName] = [];

            // Generate a new token asynchronously with the recently created tokenOptions
            session.generateToken(tokenOptions)
                .then(token => {
                    // Store the new token in the collection of tokens
                    mapSessionNamesTokens[sessionName].push(token);
                    console.log("generateToken tokenOptions:"+JSON.stringify(tokenOptions)+"----token:"+token+" OpenVidu.hostname:"+OpenVidu.hostname);

                    // Return the Token to the client
                    res.status(200).send({
                        0: token
                    });
                })
                .catch(error => {
                    console.error(error);
                });
        })
        .catch(error => {
            console.error(error);
        });
}


// Remove user from session
app.post('/api-sessions/remove-user', function (req, res) {
    if (!isLogged(req.session)) {
        req.session.destroy();
        res.status(401).send('User not logged');
    } else {
        // Retrieve params from POST body
        var sessionName = req.body.sessionName;
        var token = req.body.token;
        console.log('Removing user | {sessionName, token}={' + sessionName + ', ' + token + '}');

        // If the session exists
        if (mapSessions[sessionName] && mapSessionNamesTokens[sessionName]) {
            var tokens = mapSessionNamesTokens[sessionName];
            var index = tokens.indexOf(token);

            // If the token exists
            if (index !== -1) {
                // Token removed
                tokens.splice(index, 1);
                console.log(sessionName + ': ' + tokens.toString());
            } else {
                var msg = 'Problems in the app server: the TOKEN wasn\'t valid';
                console.log(msg);
                res.status(500).send(msg);
            }
            if (tokens.length == 0) {
                // Last user left: session must be removed
                console.log(sessionName + ' empty!');
                delete mapSessions[sessionName];
            }
            res.status(200).send();
        } else {
            var msg = 'Problems in the app server: the SESSION does not exist';
            console.log(msg);
            res.status(500).send(msg);
        }
    }
});

/* REST API */



/* AUXILIARY METHODS */

function login(user, pass) {
    return (users.find(u => (u.user === user) && (u.pass === pass)));
}

function isLogged(session) {
    return (session.loggedUser != null);
}

function getBasicAuth() {
    return 'Basic ' + (new Buffer('OPENVIDUAPP:' + OPENVIDU_SECRET).toString('base64'));
}


process.on('uncaughtException', function(err) {
    console.log(err);
});