export default [
  {
    page: "ssd-health-check",
    name: "sample reports cycle through healthy, replacement and caution verdicts without uploads",
    async run(t) {
      for (const expected of ["yes", "no", "none"]) {
        await t.page.click("#ssd-sample");
        await t.page.waitFor(`!document.querySelector('#ssd-out').hidden && document.querySelector('#ssd-verdict').dataset.ok === ${JSON.stringify(expected)}`);
      }
      await t.page.click("#ssd-clear");
      t.eq(await t.page.eval("document.querySelector('#ssd-out').hidden"), true, "clear hides output");
    },
  },
  {
    page: "ssd-health-check",
    name: "missing wear remains unknown instead of showing a healthy verdict",
    async run(t) {
      await t.page.setValue("#ssd-in", "available_spare: 100\nmedia_errors: 0\ncritical_warning: 0");
      await t.page.waitFor("!document.querySelector('#ssd-out').hidden");
      t.eq(await t.page.eval("document.querySelector('#ssd-verdict').dataset.ok"), "none", "unknown wear");
      t.eq(await t.page.eval("document.querySelector('#ssd-verdict').textContent"), "No faults found, but wear is unknown", "headline");
      t.eq(await t.page.eval("document.querySelector('#ssd-pu').textContent"), "-", "missing percentage");
    },
  },
  {
    page: "ssd-health-check",
    name: "unusable counters are rejected and valid input recovers",
    async run(t) {
      await t.page.setValue("#ssd-in", "percentage_used: -1");
      await t.waitError();
      t.eq(await t.page.eval("document.querySelector('#ssd-out').hidden"), true, "invalid report hidden");
      await t.page.setValue("#ssd-in", "percentage_used: 2\ndata_units_written: 0");
      await t.page.waitFor("!document.querySelector('#ssd-out').hidden");
      t.eq(await t.page.eval("document.querySelector('#ssd-verdict').dataset.ok"), "yes", "valid report recovers");
    },
  },
];
