// Optional browser regression: requires Playwright and Chromium, no runtime dependency.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const origin = process.env.DYLAN_PREVIEW_URL || "http://127.0.0.1:4173";
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const today = new Date().toLocaleDateString("en-CA");
    async function nav(name) {
      if (
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .isVisible()
      )
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
    }
    async function download() {
      const waiting = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export workspace", exact: true })
        .click();
      const file = await waiting;
      return JSON.parse(await fs.readFile(await file.path(), "utf8"));
    }
    const readRaw = () =>
      page.evaluate(() => localStorage.getItem("dylan-os-v1"));
    await page.goto(origin);
    for (const version of [undefined, 1, 2, 3, 4, 5]) {
      const original = {
        ...(version ? { schemaVersion: version } : {}),
        extension: { keep: "original" },
        tasks: [
          {
            id: "task",
            name: "Real task",
            category: "Personal",
            priority: "High",
            due: today,
            completed: false,
            recurring: false,
          },
        ],
        courses: [
          {
            id: "course",
            name: "Course",
            code: "101",
            instructor: "",
            grade: null,
            notes: "Keep",
          },
        ],
        assignments: [
          {
            id: "exam",
            name: "Exam",
            courseId: "course",
            due: today,
            type: "Exam",
            completed: false,
          },
        ],
        weights: [{ date: today, value: 180, extension: "keep" }],
        nutrition: [{ date: today, calories: 2100, protein: 150, steps: 8000 }],
        workouts: [],
        habits: [{ name: "My habit", dates: [today] }],
        dates: [{ name: "Important date", date: today }],
        goalWeight: 175,
        ...(version === 5 ? { commitments: [], weeklyReflections: [] } : {}),
      };
      const raw = JSON.stringify(original);
      await page.evaluate((raw) => {
        localStorage.clear();
        localStorage.setItem("dylan-os-v1", raw);
      }, raw);
      await page.reload();
      await page
        .getByRole("heading", { name: "Make today count.", exact: true })
        .waitFor();
      assert.equal(await readRaw(), raw, "load must not rewrite legacy bytes");
      await nav("Data & Backup");
      const first = await download();
      assert.equal(first.schemaVersion, 6);
      for (const key of ["habits", "dates", "weights", "nutrition"])
        assert(
          first[key].every((r) => typeof r.id === "string" && r.id.length),
        );
      assert.equal(
        await readRaw(),
        raw,
        "export must not rewrite legacy bytes",
      );
      await page.reload();
      await nav("Data & Backup");
      const second = await download();
      for (const key of ["habits", "dates", "weights", "nutrition"])
        assert.deepEqual(
          first[key],
          second[key],
          "identity must remain stable across reload",
        );
      await nav("Tasks");
      await page
        .getByRole("button", { name: "Complete Real task", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem("dylan-os-v1")).schemaVersion === 6,
      );
      const backups = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("dylan-os-backups-v1")),
      );
      assert.equal(
        backups[0].raw,
        raw,
        "migration must snapshot original bytes",
      );
      await nav("Today");
      await page.getByRole("button", { name: "My habit", exact: true }).click();
      await page
        .getByRole("button", { name: "Delete habit", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Undo deletion", exact: true })
        .click();
      await page
        .getByRole("button", { name: "My habit", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Important date", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Delete date", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Undo deletion", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Important date", exact: true })
        .waitFor();
      await nav("Data & Backup");
      await page.getByLabel("Import workspace file").setInputFiles({
        name: "legacy.json",
        mimeType: "application/json",
        buffer: Buffer.from(raw),
      });
      await page
        .getByRole("heading", { name: "Review before replacing", exact: true })
        .waitFor();
      await page
        .getByLabel("I understand this replaces my current workspace.")
        .check();
      await page
        .getByRole("button", { name: "Confirm replacement", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          !JSON.parse(localStorage.getItem("dylan-os-v1")).tasks[0].completed,
      );
      const restored = JSON.parse(await readRaw());
      for (const key of ["habits", "dates", "weights", "nutrition"])
        assert.deepEqual(restored[key], first[key]);
      assert.deepEqual(restored.extension, original.extension);
      assert.equal(restored.assignments[0].courseId, "course");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of [
      "Today",
      "Weekly Planner",
      "College",
      "Fitness",
      "Tasks",
      "AI Assistant",
      "Data & Backup",
    ]) {
      await nav(route);
      await page.waitForTimeout(100);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        route + " mobile overflow",
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS: legacy schemas 1–5/unversioned, stable migrations, exact pre-migration snapshots, legacy import, habit/date Undo, desktop/mobile navigation; no browser errors.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
