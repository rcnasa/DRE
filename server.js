'use strict';

var record = require('blue-button-record');

var passport = require('passport');

var favicon = require('serve-favicon');
var logger = require('morgan');
var multiparty = require('connect-multiparty');
var methodOverride = require('method-override');
var session = require('express-session');
var bodyParser = require('body-parser');
//var multer = require('multer');
//var errorHandler = require('errorhandler');
var cookieParser = require('cookie-parser');
var static = require('serve-static');

//app.use(express3.bodyParser());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json({
    'strict': false
}));

//Adding CORS for Swagger UI
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Credentials", true);
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT");
    next();
});

//to prevent caching of API calls
app.disable('etag');

app.use('/docs', express.static('./swagger'));

app.use(logger('dev'));
app.use(methodOverride());
app.use(cookieParser());
app.use('/api/v1/storage', multiparty());

var redisStore = require('connect-redis')(session); //uncomment for Redis session support during development

//to run fully built UI use this line (run "grunt build" in /client first)
//app.set('client_location', path.resolve(__dirname, './client/dist'));

//to run development version of UI use this line
app.set('client_location', path.resolve(__dirname, './client/app'));

//app.set('client_location', path.resolve(__dirname, '../phr-prototype/dist'));

//app.use(express.favicon(config.client.location + '/favicon.ico'));
app.use(express.static(app.get('client_location')));
app.use(function (req, res, next) {
    var requestPath = '';
    if (req.path.substring(req.path.length - 1) === '/') {
        requestPath = req.path.substring(0, req.path.length - 1);
    } else {
        requestPath = req.path;
    }
    var viewPath = app.get('client_location') + requestPath + '.html';
    fs.exists(viewPath, function (exists) {
        //console.log(viewPath);
        if (exists) {
            res.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
            res.render(viewPath);
        } else {
            next();
        }
    });
});

/*      Porting notes from express 3: Item 1 was what it was before, 2s are
        equivalent versions from previous express 3 versions */
//     1) app.use(express.bodyParser());
//     2)app.use(connect.json());
//     2)app.use(connect.urlencoded());
//     2)app.use(connect.multipart());
app.set('redis_url', process.env.REDIS_URL || 'localhost');
app.set('redis_port', process.env.REDIS_PORT || 6379);

//app.use(express.session({ secret: 'keyboard cat', key: 'sid', cookie: { secure: true }}));
app.use(session({
    secret: 'keyboard cat',
    resave: true,
    saveUninitialized: true,
    store: new redisStore({
            host: app.get('redis_url'),
            port: app.get('redis_port'),
            prefix: 'chs-sess'
        }) //uncomment for Redis session support during development
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

//Initialize Database Connection.

app.set('db_url', process.env.MONGO_URL || 'localhost');
app.set('db_port',process.env.MONGO_PORT || 27017);
app.set('db_name', process.env.MONGO_NAME || 'dre');

console.log("DB URL: ", app.get('db_url'));
console.log("DB PORT: ", app.get('db_port'));

var storage = require('./lib/storage');
app.use(storage);

var parser = require('./lib/parser');
app.use(parser);

var healthRecord = require('./lib/record');
app.use(healthRecord);

var merges = require('./lib/merge');
app.use(merges);

var match = require('./lib/match');
app.use(match);

var notification = require('./lib/notification');
app.use(notification);

var login = require('./lib/login');
app.use(login);

var account = require('./lib/account');
app.use(account);

var accountHistory = require('./lib/account-history');
app.use(accountHistory);

var notes = require('./lib/notes');
app.use(notes);

app.set('port', (process.env.PORT || 3000));

app.set('mllp_host', (process.env.MLLP_HOST || '127.0.0.1'));
app.set('mllp_port', (process.env.MLLP_PORT || 6969));

//Launch Application.
record.connectDatabase(app.get('db_url')+':'+app.get('db_port'), function (err) {
    console.log(app.get('db_url')+':'+app.get('db_port'));
    if (err) {
        console.log("DB error");
        console.log(err);
    } else {
        app.listen(app.get('port'), '0.0.0.0');
        console.log("Server listening on port " + app.get('port'));
    }
});

//Launch MLLP server/listener
var mllp = require('mllp-node');

var server = new mllp.MLLPServer(app.get('mllp_host'), app.get('mllp_port'));
console.log("MLLP listening on host " + app.get('mllp_host') + ", port " + app.get('mllp_port'));

server.on('hl7', function (data) {
    //console.log("just an example", data);
    //mime type: application/edi-hl7

    var record_metadata = {
        'type': 'application/edi-hl7',
        'name': 'labs.hl7',
        'size': data.length
    };
    var record_data = data;

    var hl7 = require('hl7');

    var hl7_record = hl7.parseString(record_data);

    //console.log(">>>>>>>>>", hl7_record);

    var tr = require('blue-button-hl7');

    var parsed_record = tr.translate(record_data);

    //extract name of sending facility to add to file metadata
    try {
        record_metadata.source = hl7_record[0][6][0][0];
    } catch (ex) {
        console.log("HL7 message doesn't include sending facility name");
    }

    //console.log("parsed HL7 data", JSON.stringify(parsed_record, null, 4));

    //call PIM from BB-record to get candidates
    var ptInfo = parsed_record.demographics; //patient ignored for now, return list of all patients in DB

    //console.log(JSON.stringify({
    //    "data": ptInfo
    //}, null, 4));

    record.getCandidates({
        "data": ptInfo
    }, function (smth, docs) {
        //PIM call here based on candidates
        //console.log("candidates", JSON.stringify(docs, null, 4));

        var username;
        //assign patient=test for now
        username = '';

        //parsed_record - incoming data from HL7
        //docs - list of candidates fetched from Mongo

        var pim = require('blue-button-pim');

        //var configs = require('configs')

        //console.log(JSON.stringify({
        //    data: parsed_record.demographics
        //}, null, 4));

        var match = pim.compare_candidates(parsed_record.demographics, docs);

        console.log(match);

        //extract username from list of candidates
        for (var i = 0; i < match.length; i++) {
            if (match[i].match === "automatic") {
                username = match[i].pat_key;
                console.log("patient matched to ", username);
            }
        }

        if (username !== "") {
            //import HL7 data into patient record based on identified username
            storage.importHL7Record(username, record_metadata, record_data, parsed_record, function () {
                console.log("hl7 message saved");
            });
        } else {
            server.listen(server.get('port'), '0.0.0.0');
            console.log("Server listening on port " + server.get('port'));
        }
    });
