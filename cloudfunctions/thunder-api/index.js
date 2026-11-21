const cloud = require('wx-server-sdk');
const { createCloudBaseStore } = require('./cloudbase-store.cjs');
const { createProfileHandler } = require('./profile.cjs');
const content = require('./initial-content.json');
const { createRunHandler } = require('./run-api.cjs');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const store = createCloudBaseStore(cloud);

exports.main = createProfileHandler({
  // Called per invocation, never from event fields or the second main argument.
  getWXContext: () => cloud.getWXContext(),
  getAppId: () => process.env.TR_APP_ID,
  store,
  content,
  handleAction: createRunHandler({ store, content, loadSimulation: () => require('./simulation.cjs') }),
});
