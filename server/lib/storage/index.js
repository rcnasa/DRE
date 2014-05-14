/*=======================================================================
Copyright 2013 Amida Technology Solutions (http://amida-tech.com)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
======================================================================*/

var express = require('express');
var mongo = require('mongodb');
var fs = require('fs');
var app = module.exports = express();
var parser = require('../parser/index.js');
var allergy = require('../../models/allergies');
var allergyFunctions = require('../record/allergies');
var dre = require('../dre/index.js');

var extractRecord = parser.extractRecord;
var record = require('../record');

function validateFileMessage(requestObject, callback) {
  //Placeholder validation function.
  callback(null);
}

//Wrapper function to save all components of an incoming object.
function saveComponents(masterObject, sourceID, callback) {

  //console.log(masterObject);
  if (masterObject.allergies.length > 0) {
    allergyFunctions.saveAllergies(masterObject.allergies, sourceID, function(err) {
      if (err) {
        callback(err);
      } else {
        callback(null);
      }
    });
  } else {
    callback(null);
    //Need to have a final check.
  }
}

function getSavedComponents(callback) {

  var savedObject = {};

  allergyFunctions.getAllergies(function(err, savedAllergies) {
    savedObject.allergies = savedAllergies;
    callback(null, savedObject);
  });
}

function attemptParse(recordType, recordData, callback) {
  //console.log(recordType);
  if (recordType === 'application/xml' || recordType === 'text/xml') {
    extractRecord(recordData, function(err, xmlType, parsedRecord) {
      if (err) {
        callback(err);
      } else {
        if (xmlType === 'ccda') {
          callback(null, xmlType, parsedRecord);
        } else {
          callback(null, null);
        }
      }
    });
  } else {
    callback(null, null);
  }
}

//Master wrapper function.
function processUpload(recordUpload, callback) {
  if (!recordUpload) {
    callback('Wrong object name');
  } else {
    validateFileMessage(recordUpload, function(err) {
      if (err) {
        callback(err);
      } else {
        fs.readFile(recordUpload.path, 'utf8', function(err, fileData) {
          if (err) {
            callback(err);
          } else {
            attemptParse(recordUpload.type, fileData, function(err, recType, recParsed) {
              if (err) {
                callback(err);
              } else if (!recType) {
                record.storeFile(fileData, recordUpload, null, function(err, fileInfo) {
                  if (err) {
                    callback(err);
                  } else {
                    callback(null);
                  }
                });
              } else {
                record.storeFile(fileData, recordUpload, recType, function(err, fileInfo) {
                  if (err) {
                    callback(err);
                  } else {
                    getSavedComponents(function(err, recSaved) {
                      if (err) {
                        callback(err);
                      } else {
                        dre.reconcile(recParsed, recSaved, fileInfo._id, function(err, recMatchResults) {
                          //console.log(recMatchResults);
                          saveComponents(recMatchResults, fileInfo._id, function(err, res) {
                            if (err) {
                              callback(err);
                            } else {
                              callback(null);
                            }
                          });
                        });
                      }
                    });
                  }
                });
              }
            });
          }
        });
      }
    });
  }
}

app.get('/api/v1/storage/record/:identifier', function(req, res) {
    record.getRecord(req.params.identifier, function(err, filename, returnFile) {
        if (err) {
            throw err;
        }
        res.setHeader('Content-disposition', 'attachment; filename=' + filename);
        res.send(returnFile);
    });
});

//Routes.

//Returns list of records in storage.
app.get('/api/v1/storage', function(req, res) {

  record.getRecordList(function(err, recordList) {
    var recordResponse = {};
    recordResponse.storage = recordList;
    res.send(recordResponse);
  });

});

//Uploads a file into storage.
app.put('/api/v1/storage', function(req, res) {

  //console.log(req.files.file);

  processUpload(req.files.file, function(err) {
    if (err) {
      console.error(err);
      res.send(400, err);
    } else {
      res.send(200);
    }
  });

});
