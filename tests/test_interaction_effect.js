// Slice 3 (harness reliability): observable-effect verification for click_element. A click
// "succeeding" only means a DOM element was found and clicked — not that the app reacted. When the
// page looks identical before and after (a frequent sign the clicked element has no handler wired
// up), the tool result now says so and tells the model to verify the real effect, instead of
// letting an optimistic success get mistaken for "the thing happened". This is the exact failure a
// live session hit: click_element kept "succeeding" on a lobby button that had no click handler.
const test = require('tape');
global.window = global.window || {};
const agent = require('../agent.js');

function stubBrowser(pages) {
  // pages: array of results returned by successive browser calls
  let i = 0;
  global.window.api = {
    browserOpenUrl: async () => pages[i++],
    browserClickElement: async () => pages[i++]
  };
}

test('click_element flags that the page did not change (no observed effect) when the click did nothing', async (t) => {
  const samePage = { success: true, url: 'http://localhost:3000/controller.html', title: 'Sumo Controller', text: 'PILOT CHECKED IN Waiting for the host to choose a game...' };
  // open_url establishes the page signature; the click returns the identical page.
  stubBrowser([samePage, { ...samePage }]);

  await agent.executeTool('open_url', { url: 'http://localhost:3000/controller.html' }, '/ws', {});
  const clickResult = await agent.executeTool('click_element', { text: 'Apex Velocity' }, '/ws', {});

  t.equal(clickResult.success, true, 'the click itself still reports success (the element was clicked)');
  t.equal(clickResult.observedEffect, false, 'but observedEffect is false because the page did not change');
  t.ok(/did NOT visibly change|no event handler|verify/i.test(clickResult.verificationNote || ''),
    'a verification note warns that the click may not have triggered anything and to verify the real effect');
  t.end();
});

test('click_element reports an observed effect when the page changes after the click', async (t) => {
  const before = { success: true, url: 'http://localhost:3000/controller.html', title: 'Sumo Controller', text: 'PILOT CHECKED IN Waiting for the host to choose a game...' };
  const after = { success: true, url: 'http://localhost:3000/controller.html', title: 'Sumo Controller', text: 'APEX VELOCITY STEERING THROTTLE / BRAKE PIT STOP' };
  stubBrowser([before, after]);

  await agent.executeTool('open_url', { url: 'http://localhost:3000/controller.html' }, '/ws', {});
  const clickResult = await agent.executeTool('click_element', { text: 'Apex Velocity' }, '/ws', {});

  t.equal(clickResult.observedEffect, true, 'the page content changed, so the click had an observed effect');
  t.notOk(clickResult.verificationNote, 'no no-effect warning is attached when something actually changed');
  t.end();
});

test('a failed click still throws rather than reporting a misleading no-effect success', async (t) => {
  global.window.api = { browserClickElement: async () => ({ success: false, error: 'Element not found' }) };
  try {
    await agent.executeTool('click_element', { text: 'Nonexistent' }, '/ws', {});
    t.fail('a failed click should throw');
  } catch (e) {
    t.ok(/Element not found|Click failed/.test(e.message), 'the underlying click failure is surfaced');
  }
  t.end();
});
