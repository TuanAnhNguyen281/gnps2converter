// Run against scripts/research-preview.ts + Vite on 5193. Uses only disposable QA data.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const output = path.resolve("qa/research-ai");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      colorScheme: "dark",
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let stage = "login";
  const nav = (name) =>
    page
      .locator(".workspace-nav")
      .first()
      .getByRole("button", { name, exact: true })
      .click();
  const shot = (name) =>
    page.screenshot({ path: path.join(output, name + ".png"), fullPage: true });
  try {
    await page.goto("http://localhost:5193");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.locator("input[name=email]").fill("research-qa@example.test");
    await page.locator("input[name=password]").fill("local-qa-password-123");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.locator(".workspace-nav").first().waitFor();
    stage = "settings";
    await nav("Cài đặt AI");
    await page.getByLabel("Tên provider", { exact: true }).fill("QA Provider");
    await page
      .getByLabel("Base URL", { exact: true })
      .fill("https://example.com/v1");
    await page.getByLabel("API key", { exact: true }).fill("fake-qa-key");
    await page
      .getByRole("button", { name: "Lưu provider", exact: true })
      .click();
    await page.getByRole("button", { name: "Tải model", exact: true }).click();
    const model = page
      .locator(".model-editor")
      .filter({
        has: page.getByRole("heading", { name: "demo-model", exact: true }),
      });
    await model.getByLabel("Stream", { exact: true }).check();
    await model.getByRole("button", { name: "Lưu model", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Đã lưu model." })
      .waitFor();
    const picker = page
      .locator(".ai-settings")
      .getByRole("combobox", { name: "Chọn provider và model" });
    await picker.selectOption({ label: "demo-model" });
    await page
      .getByRole("button", { name: "Lưu mặc định", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Đã lưu model mặc định." })
      .waitFor();
    await shot("settings-desktop");
    stage = "project";
    await nav("Project & AI chat");
    await page.getByLabel("Tên project", { exact: true }).fill("Project QA");
    await page
      .getByLabel("Mục tiêu nghiên cứu", { exact: true })
      .fill("Phân tích các hợp chất trong báo cáo mẫu");
    await page
      .getByRole("button", { name: "Tạo project", exact: true })
      .click();
    await page.getByLabel("Tên phiên mới", { exact: true }).fill("Phiên QA");
    await page.getByRole("button", { name: "Tạo phiên", exact: true }).click();
    await page
      .getByRole("heading", { name: "Trợ lý nghiên cứu", exact: true })
      .waitFor();
    await page
      .getByRole("combobox", {
        name: "Báo cáo chưa thuộc project",
        exact: true,
      })
      .selectOption({ label: "Báo cáo nghiên cứu mẫu" });
    await page
      .getByRole("button", { name: "Thêm vào project", exact: true })
      .click();
    await page
      .locator(".research-report")
      .filter({ hasText: "Báo cáo nghiên cứu mẫu" })
      .waitFor();
    stage = "chat";
    await page
      .getByRole("button", { name: "Hội thoại mới", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Phạm vi dữ liệu", exact: true })
      .selectOption("project");
    await page
      .getByLabel("Câu hỏi", { exact: true })
      .fill("Tóm tắt báo cáo mẫu và sai số ppm");
    await page
      .getByRole("button", { name: "Gửi câu hỏi", exact: true })
      .click();
    await page
      .locator(".chat-message.assistant")
      .filter({ hasText: "hoàn tất" })
      .waitFor({ timeout: 15000 });
    await page
      .getByRole("button", { name: "Nguồn dữ liệu & token", exact: true })
      .click();
    await page.getByText("Token: 100 vào / 40 ra", { exact: false }).waitFor();
    await shot("chat-desktop-dark");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    if (overflow) throw new Error("Desktop horizontal overflow");
    stage = "reload";
    await page.reload();
    await page
      .getByRole("button", { name: "Báo cáo của tôi", exact: true })
      .click();
    await nav("Project & AI chat");
    await page
      .locator(".chat-message.assistant")
      .filter({ hasText: "hoàn tất" })
      .waitFor();
    if (
      (await page
        .getByRole("combobox", { name: "Chọn phiên nghiên cứu" })
        .inputValue()) === ""
    )
      throw new Error("Research session was not restored");
    stage = "source-report";
    await page
      .getByRole("button", { name: "Nguồn dữ liệu & token", exact: true })
      .click();
    await page.locator(".chat-sources").getByRole("button").first().click();
    await page.locator(".compound-dialog").waitFor();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "AI chat · Project", exact: true })
      .click();
    await page
      .locator(".ai-drawer .chat-message.assistant")
      .filter({ hasText: "hoàn tất" })
      .waitFor();
    await shot("report-chat-drawer");
    await page.getByRole("button", { name: "Đóng chat", exact: true }).click();
    stage = "mobile";
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "AI chat · Project", exact: true })
      .click();
    await page.locator(".ai-drawer .chat-message.assistant").waitFor();
    await shot("chat-mobile-dark");
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error("Mobile horizontal overflow");
    await page.getByRole("button", { name: "Đóng chat", exact: true }).click();
    stage = "light";
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("button", { name: "Bật giao diện sáng", exact: true })
      .click();
    await page
      .getByRole("button", { name: "AI chat · Project", exact: true })
      .click();
    await page.locator(".ai-drawer .chat-message.assistant").waitFor();
    await shot("chat-desktop-light");
    if (errors.length) throw new Error(errors.join("\n"));
    fs.writeFileSync(
      path.join(output, "browser-results.json"),
      JSON.stringify(
        {
          passed: true,
          checks: [
            "login",
            "configure provider/model",
            "create project/session",
            "attach report",
            "stream chat",
            "sources/usage",
            "reload history/session",
            "report chat drawer",
            "mobile no overflow",
            "light/dark",
          ],
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(
      "Browser QA passed: settings/project/session/stream/chat sources/reload/report panel/mobile/light/dark.",
    );
  } catch (e) {
    await shot("failure");
    fs.writeFileSync(
      path.join(output, "failure.txt"),
      stage +
        "\n" +
        e.stack +
        "\n\n" +
        (await page.locator("body").innerText()),
    );
    console.error(stage + ": " + e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
