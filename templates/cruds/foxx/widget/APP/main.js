'use strict';
const db = require('@arangodb').db;
const joi = require('joi');
const models = require('./models.js');
const _ = require('lodash');
const createRouter = require('@arangodb/foxx/router');
const sessionsMiddleware = require('@arangodb/foxx/sessions');
const jwtStorage = require('@arangodb/foxx/sessions/storages/jwt');
require("@arangodb/aql/cache").properties({ mode: "on" });

const router = createRouter();
const _settings = db.foxxy_settings.firstExample();

const sessions = sessionsMiddleware({
  storage: jwtStorage(_settings.jwt_secret_admin),
  transport: 'header'
});
module.context.use(sessions);
module.context.use(router);

var typeCast = function(type, value) {
  var value = unescape(value)
  if(type == "integer") value = parseInt(value)
  if(type == "float")   value = parseFloat(value)
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

// Comment this block if you want to avoid authorization
module.context.use(function (req, res, next) {
  if(!req.session.uid) res.throw('unauthorized')
  res.setHeader("Access-Control-Expose-Headers", "X-Session-Id")
  next();
});

// -----------------------------------------------------------------------------
router.get('/:service/page/:page/:perpage', function (req, res) {
  const order = models()[req.pathParams.service].sort || 'SORT doc._key DESC'
  let includes = ''
  let include_merge = ''
  if(models()[req.pathParams.service].includes) {
    includes = models()[req.pathParams.service].includes.conditions
    include_merge = models()[req.pathParams.service].includes.merges
  }
  res.send({
    model: models()[req.pathParams.service],
    data: db._query(`
    LET count = LENGTH(@@collection)
    LET data = (
      FOR doc IN @@collection
        LET image = (FOR u IN uploads FILTER u.object_id == doc._id SORT u.pos LIMIT 1 RETURN u)[0]
        ${order}
        ${includes}
        LIMIT @offset,@perpage
        RETURN MERGE(doc, { image: image ${include_merge} })
    )
    RETURN { count: count, data: data }
    `, { "@collection": req.pathParams.service,
         "offset": (req.pathParams.page - 1) * parseInt(req.pathParams.perpage),
         "perpage": parseInt(req.pathParams.perpage)
    }).toArray()
  });
})
.header('X-Session-Id')
.description('Returns all objects');
// -----------------------------------------------------------------------------
router.get('/:service/search/:term', function (req, res) {
  var locale = req.headers['foxx-locale']
  if(locale.match(/[a-z]+/) == null) locale = 'en'
  const order = models()[req.pathParams.service].sort || 'SORT doc._key DESC'
  let includes = ''
  let include_merge = ''
  if(models()[req.pathParams.service].includes) {
    includes = models()[req.pathParams.service].includes.conditions
    include_merge = models()[req.pathParams.service].includes.merges
  }
  if(locale.match(/[a-z]+/) == null) locale = 'en'
  res.send({ data: db._query(`
    FOR doc IN FULLTEXT(@@collection, 'search.${locale}', @term)
    LET image = (FOR u IN uploads FILTER u.object_id == doc._id SORT u.pos LIMIT 1 RETURN u)[0]
    ${order}
    ${includes}
    LIMIT 100
    RETURN MERGE(doc, { image: image ${include_merge} })`, { "@collection": req.pathParams.service,
                 "term": req.pathParams.term }).toArray() })
})
.header('foxx-locale')
.header('X-Session-Id')
.description('Returns First 100 found objects');
// -----------------------------------------------------------------------------
router.get('/:service/:id', function (req, res) {
  const collection = db._collection(req.pathParams.service)
  res.send({ fields: models()[req.pathParams.service],
             data: collection.document(req.pathParams.id) });
})
.header('X-Session-Id')
.description('Returns object within ID');
// -----------------------------------------------------------------------------
router.get('/:service/fields', function (req, res) {
  res.send({ fields: models()[req.pathParams.service] });
})
.header('X-Session-Id')
.description('Get all fields to build form');
// -----------------------------------------------------------------------------
router.post('/:service', function (req, res) {
  const collection = db._collection(req.pathParams.service)
  let fields = models()[req.pathParams.service]
  const body = JSON.parse(req.body.toString())
  var obj = null
  var errors = []
  if(!_.isArray(fields)) fields = fields.model
  try {
    var schema = {}
    _.each(fields, function(f) {schema[f.n] = f.j })
    errors = joi.validate(body, schema, { abortEarly: false }).error.details
  }
  catch(e) {}
  if(errors.length == 0) {
    var data = fieldsToData(fields, body, req.headers)
    if(models()[req.pathParams.service].search) {
      var search_arr = []
      _.each(models()[req.pathParams.service].search, function(s) {
        if(_.isPlainObject(data[s])) {
          search_arr.push(data[s][req.headers['foxx-locale']])
        } else {
          search_arr.push(data[s])
        }
      })
      data.search = {}
      data.search[req.headers['foxx-locale']] = search_arr.join(" ")
    }
    if(models()[req.pathParams.service].timestamps === true) { data.created_at = +new Date() }
    if(models()[req.pathParams.service].slug) {
      var slug = _.map(models()[req.pathParams.service].slug, function(field_name) {
        return data[field_name]
      })
      data['slug'] = _.kebabCase(slug)
    }
    obj = collection.save(data, { waitForSync: true })
  }
  res.send({ success: errors.length == 0, data: obj, errors: errors });
}).header('foxx-locale')
.header('X-Session-Id')
.description('Create a new object.');
// -----------------------------------------------------------------------------
router.post('/:service/:id', function (req, res) {
  const collection = db._collection(req.pathParams.service)
  let fields = models()[req.pathParams.service]
  const body = JSON.parse(req.body.toString())
  var obj = null
  var errors = []
  if(!_.isArray(fields)) fields = fields.model
  try {
    var schema = {}
    _.each(fields, function(f) {schema[f.n] = f.j })
    errors = joi.validate(body, schema, { abortEarly: false }).error.details
  }
  catch(e) {}
  if(errors.length == 0) {
    var object = collection.document(req.pathParams.id)
    var data = fieldsToData(fields, body, req.headers)
    if(models()[req.pathParams.service].search) {
      data.search = {}
      var search_arr = []
      _.each(models()[req.pathParams.service].search, function(s) {
        if(_.isPlainObject(data[s])) {
          search_arr.push(data[s][req.headers['foxx-locale']])
        } else {
          search_arr.push(data[s])
        }
      })
      data.search[req.headers['foxx-locale']] = search_arr.join(" ")
    }
    if(models()[req.pathParams.service].timestamps === true) { data.updated_at = +new Date() }
    if(models()[req.pathParams.service].slug) {
      var slug = _.map(models()[req.pathParams.service].slug, function(field_name) {
        return data[field_name]
      })
      data['slug'] = _.kebabCase(slug)
    }
    obj = collection.update(object, data)
  }
  res.send({ success: errors.length == 0, data: obj, errors: errors });
})
.header('foxx-locale')
.header('X-Session-Id')
.description('Update an object.');
// -----------------------------------------------------------------------------
router.patch('/:service/:id/:field/toggle', function (req, res) {
  const collection = db._collection(req.pathParams.service)
  var item = collection.firstExample({_key: req.pathParams.id})
  let column = _.first(_.filter(models()[req.pathParams.service].columns, function(el) { return el.name == req.pathParams.field}))
  if(item) {
    var data = {}
    data[req.pathParams.field] = !item[req.pathParams.field]
    collection.update(item, data)
    var returned_data = !item[req.pathParams.field]
    if(column && column.values) returned_data = column.values[!item[req.pathParams.field]]
    res.send({ success: true, data: returned_data })
  } else {
    res.send({ success: false })
  }
})
.header('foxx-locale')
.header('X-Session-Id')
.description('Toggle boolean field.');
// -----------------------------------------------------------------------------
router.get('/:service/:id/duplicate', function (req, res) {
  var new_obj = db._query(`
    FOR doc IN @@collection
    FILTER doc._key == @key
    INSERT UNSET( doc, "_id", "_key", "_rev" ) IN @@collection RETURN NEW
  `, { "@collection": req.pathParams.service, key: req.pathParams.id }).toArray()[0]
  res.send(new_obj);
})
.header('X-Session-Id')
.description('duplicate an object.');
// -----------------------------------------------------------------------------
router.delete('/:service/:id', function (req, res) {
  const collection = db._collection(req.pathParams.service)
  collection.remove(req.pathParams.service+"/"+req.pathParams.id)
  res.send({success: true });
})
.header('X-Session-Id')
.description('delete an object.');

// Sub
// -----------------------------------------------------------------------------
router.get('/:service/:id/:subservice/:key/page/:page/:perpage', function (req, res) {
  let includes = ''
  let include_merge = ''
  if(models()[req.pathParams.service].sub_models[req.pathParams.subservice].includes) {
    includes = models()[req.pathParams.service].sub_models[req.pathParams.subservice].includes.conditions
    include_merge = models()[req.pathParams.service].sub_models[req.pathParams.subservice].includes.merges
  }
  res.send({ data: db._query(`
    LET count = LENGTH(@@collection)
    LET data = (
      FOR doc IN @@collection
        FILTER doc.@key == @id
        SORT doc._key DESC
        ${includes}
        LIMIT @offset,@perpage
        RETURN MERGE(doc, { ${include_merge} })
    )
    RETURN { count: count, data: data }
    `, { "@collection": req.pathParams.subservice,
         "offset": (req.pathParams.page - 1) * parseInt(req.pathParams.perpage),
         "perpage": parseInt(req.pathParams.perpage),
         "key": req.pathParams.key,
         "id": req.pathParams.id }).toArray() });
})
.header('X-Session-Id')
.description('Returns all sub objects');
// -----------------------------------------------------------------------------
router.post('/sub/:service/:subservice', function (req, res) {
  const collection = db._collection(req.pathParams.subservice)
  const fields = models()[req.pathParams.service].sub_models[req.pathParams.subservice].fields
  const body = JSON.parse(req.body.toString())
  var obj = null
  var errors = []
  try {
    var schema = {}
    _.each(fields, function(f) {schema[f.n] = f.j })
    errors = joi.validate(body, schema, { abortEarly: false }).error.details
  }
  catch(e) {}
  if(errors.length == 0) {
    var data = fieldsToData(fields, body, req.headers)
    if(models()[req.pathParams.service].sub_models[req.pathParams.subservice].timestamps === true) { data.created_at = +new Date() }

    obj = collection.save(data, { waitForSync: true })
  }
  res.send({ success: errors.length == 0, data: obj, errors: errors });
}).header('foxx-locale')
.header('X-Session-Id')
.description('Create a new sub object.');
// -----------------------------------------------------------------------------
router.post('/sub/:service/:subservice/:id', function (req, res) {
  const collection = db._collection(req.pathParams.subservice)
  const fields = models()[req.pathParams.service].sub_models[req.pathParams.subservice].fields
  const body = JSON.parse(req.body.toString())
  var obj = null
  var errors = []
  try {
    var schema = {}
    _.each(fields, function(f) {schema[f.n] = f.j })
    errors = joi.validate(body, schema, { abortEarly: false }).error.details
  }
  catch(e) {}
  if(errors.length == 0) {
    var object = collection.document(req.pathParams.id)
    var data = fieldsToData(fields, body, req.headers)
    if(models()[req.pathParams.service].sub_models[req.pathParams.subservice].timestamps === true) { data.updated_at = +new Date() }

    obj = collection.update(object, data)
  }
  res.send({ success: errors.length == 0, data: obj, errors: errors });
})
.header('foxx-locale')
.header('X-Session-Id')
.description('Update a sub object.');