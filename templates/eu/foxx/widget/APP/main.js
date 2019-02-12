'use strict';

const db = require('@arangodb').db;
const joi = require('joi');
const fields = require('./model.js');
const config = require('./config.js')();
const _ = require('lodash');

const createRouter = require('@arangodb/foxx/router');
const sessionsMiddleware = require('@arangodb/foxx/sessions');
const jwtStorage = require('@arangodb/foxx/sessions/storages/jwt');
require("@arangodb/aql/cache").properties({ mode: "on" });

const router = createRouter();

const _settings = db.foxxy_settings.firstExample();

const sessions = sessionsMiddleware({
  storage: jwtStorage(_settings.jwt_secret),
  transport: 'header'
});
module.context.use(sessions);
module.context.use(router);

var typeCast = function(type, value) {
  var value = unescape(value)
  if(type == "integer") value = parseInt(value)
  if(type == "float") value = parseFloat(value)
  return value
}

var fieldsToData = function(fields, body, headers) {
  var data = {}
  _.each(fields, function(f) {
    if(f.tr != true) {
      if(_.isArray(body[f.n])) {
        data[f.n] = _.map(body[f.n], function(v) { return typeCast(f.t,v) })
      } else {
        if(body[f.n] === undefined) {
          if(f.t == "boolean") data[f.n] = false
          else data[f.n] = null
        } else {
          if(f.t == "boolean") data[f.n] = true
          else data[f.n] = typeCast(f.t, body[f.n])
        }
      }
    } else {
      data[f.n] = {}
      if(_.isArray(body[f.n])) {
        data[f.n][headers['foxx-locale']] = _.map(
          body[f.n], function(v) { return typeCast(f.t,v) }
        )
      } else {
        data[f.n][headers['foxx-locale']] = unescape(body[f.n])
      }
    }
  })
  return data
}

var schema = {}
_.each(fields(), function(f) {schema[f.n] = f.j })

// Comment this block if you want to avoid authorization
module.context.use(function (req, res, next) {
  if(!req.session.uid) res.throw('unauthorized')
  res.setHeader("Access-Control-Expose-Headers", "X-Session-Id")
  next();
});

// -----------------------------------------------------------------------------
router.get('/', function (req, res) {
  res.send({ fields: fields(), data: db._query(`FOR doc IN @{{objects}} RETURN doc`).toArray()[0] });
})
.header('X-Session-Id')
.description(`Returns first @{{objects}}`);
// -----------------------------------------------------------------------------
router.get('/check_form', function (req, res) {
    var errors = []
  try {
    errors = joi.validate(JSON.parse(req.queryParams.data), schema, { abortEarly: false }).error.details
  } catch(e) {}
  res.send({errors: errors });
})
.header('X-Session-Id')
.description('Check the form for live validation');
// -----------------------------------------------------------------------------
router.post('/:id', function (req, res) {
  const body = JSON.parse(req.body.toString())
  var obj = db.@{{objects}}.document(req.pathParams.id)
  var data = fieldsToData(fields(), body, req.headers)
  var errors = []
  try {
    var schema = {}
    _.each(fields(), function(f) {schema[f.n] = f.j })
    errors = joi.validate(body, schema, { abortEarly: false }).error.details
  }
  catch(e) {}
  if(errors.length == 0)db.@{{objects}}.update(obj, data)
  res.send({ success: true, errors });
})
.header('foxx-locale')
.header('X-Session-Id')
.description(`Update @{{objects}}.`);
