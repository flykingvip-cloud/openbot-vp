/** Pure browser guidance; routing decisions remain in the capability host. */
export function buildAccountComputerBrowserRoutingLines(): string[] {
  return [
    'Account Computer browser: enabled. Call the browser tool with target="sandbox" to open that signed-in desktop, navigate, click, type, and log in.',
    'Host (this Mac) browser control: blocked. This does NOT limit the Account Computer — open and operate 云电脑 with the browser tool, target="sandbox".',
    'Routing: a public page fetch or scrape (抓取, 公开首页, a URL, or "不要打开云电脑") MUST call web_fetch when a URL is present, otherwise web_search. Do not call browser for that turn.',
    "Routing: login, cookies, authenticated sites, and requests to open or operate the cloud PC (云电脑 / 云端电脑) use the browser tool on the Account Computer.",
    "Routing: opening or operating 云电脑, or logging into a site, uses the browser tool directly. Do not route that through browser-scan-proxy or independent-work. Do not tell the user to scan a QR code unless a login page actually requires it.",
    "Earlier replies in this session that say the cloud PC or the Account Computer browser is blocked are outdated. While the browser tool is listed, call it.",
    "While the browser tool is listed, do not answer with [[capability_gap:tool:browser-control]].",
    "Do not answer with [[capability_gap:tool:browser-navigation-blocked-by-ssrf-policy]] for a public site such as https://www.jd.com. Private, loopback, and metadata targets stay blocked.",
    "Password and one-time-code fields use secure_form.",
    "Login: snapshot first and check whether the site is already signed in. If it is, continue and do not ask. If login is required, open the login page. Do not ask permission before clicking 「你好，请登录」. Then call account_computer_login action=plan with the page host and signals {signedIn, password, qr, captcha, passkey}. Do not ask the user to type a password or SMS code in chat. Do not guess a QR login when password fields are visible.",
    "plan decision continue: proceed. plan decision secure_form: call secure_form action=request with field refs only. plan decision handoff: call secure_form action=handoff (qr, sms, captcha, passkey, or slider) without a custom instruction (server default). Handoff parks mid-task until login clears (auto await_return); do not treat the remind as task completion. While opening/confirming the login page and at the gate, do not narrate 快照/页面状态/登录页已经打开/登录方式二选一 to the user. In chat emit EXACTLY once this zh-CN line and nothing else that turn: 「请在云电脑窗口扫码或输入短信验证码；完成后系统会自动继续。」 No second paraphrase of the same remind, no method enumeration, no AI接管 status, no 不用点/无需点「交给AI」. plan decision autofill_needs_fields: call plan again with field refs and no values. A filled autofill receipt means the vault filled the page. Never read or repeat credentials.",
    "After a user-typed secure_form fill succeeds and the next snapshot shows the site signed in, call account_computer_login action=offer_save once for that host. Skip offer_save when plan autofilled. Saving is opt-in. The next visit defaults to the recorded choice for that host (password, qr, or auto).",
    "Shopping (购买/下单): choose the spec (选规格), add to cart (加入购物车), then checkout (去结算). Check the item, spec, quantity, price, and address (核对商品、规格、数量、价格、收货地址).",
    "Cart selection: prefer snapshot refs / click by visible SKU+size+price text over anonymous checkbox index scripts. On「只要最新挑选的这一双」, match the newly added line (e.g. size+price), uncheck others, re-read 合计 before 去结算. Never blind-toggle checkbox indices.",
    "Before clicking 提交订单, list 商品、数量、价格、地址 in the chat and get one explicit confirmation. That single confirmation is enough to submit. Do not add another blanket block.",
    "After submit, stop on the cashier or payment page (收银台/付款页). Ask the user to take over 电脑 to scan or pay. Never pay for the user (绝不代付).",
    "Decision pause (不确定就停): when price/SKU/spec/qty/address/payment is ambiguous or several candidates look plausible, STOP — ask the user to confirm or hand 电脑 (接管). Never click through a guess. Before 提交订单 / pay, summarize item+price+address and wait for confirm unless the user already said 直接下单/我来扫码 and the cashier QR is showing.",
    "Scan-to-pay (扫码支付 / 我来扫码 / 直接下单我来付): prefer 提交订单 then the native cashier QR (收银台 / pcashier.jd.com / 微信支付二维码). Never click 「立即支付」 or 「确认付款」 into 「密码支付」. Never type a payment password. If a 「密码支付」 overlay appears, click 「更多支付」 (or equivalent) until the QR/cashier page shows, then stop and hand 电脑 to the user. Do not batch-click every button matching /支付/.",
    "When the browser tool returns a platform or policy error, say it is a 云电脑 fault (云电脑故障), quote the one-line reason (引用这一行原因), and offer to retry. If open failed, retry once with navigate. If the browser tool says 云电脑还在启动, say that sentence and stop. Do not retry and do not call it a 云电脑故障. Never redirect the user to another app or device for the shopping task (不要让用户改用京东 App 或其他设备).",
    "Do not delete, empty the cart, or cancel an order (不要删除、清空购物车或取消订单) unless the user explicitly asks.",
    "After the page changes, snapshot again before using a ref.",
  ];
}

export function buildAccountComputerBrowserPendingLines(): string[] {
  return [
    "Account Computer browser: the desktop picture can show before control is ready. 云电脑还在启动，画面可以先看。",
    "Do not call the browser tool again this turn. Do not answer with [[capability_gap:tool:browser-control]].",
    "This Mac's browser is a different surface. Do not describe the Account Computer as blocked.",
  ];
}
