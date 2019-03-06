'use strict';
const db = require('@arangodb').db;

function create_collection(collection) {
  if (!db._collection(collection)) {db._createDocumentCollection(collection); }
  db._collection(collection).ensureIndex({
    type: 'fulltext',
    fields: ['search.en']
  });

  db._collection(collection).ensureIndex({
    type: 'skiplist',
    fields: ['order']
  });
}

/*@{{setup}}*/