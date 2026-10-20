export default function OpenBotHomepage() {
  const featureCards = [
    {
      title: "AI chat built for work",
      description: "Ask, summarize, draft, and move faster.",
      tone: "rose",
      icon: (
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path
            d="M6 18L5 13C5 9.68629 7.68629 7 11 7H13C16.3137 7 19 9.68629 19 13L18 18"
            strokeLinecap="round"
          />
          <path d="M8 11H16" strokeLinecap="round" />
          <path d="M9 15H13" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      title: "Knowledge at hand",
      description: "Turn documents and notes into usable context.",
      tone: "green",
      icon: (
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path
            d="M12 6C7.58172 6 4 8.68629 4 12C4 13.2386 4.50863 14.3895 5.38001 15.3552L4.5 18L7.70017 16.7504C8.94287 17.4004 10.4223 17.7778 12 17.7778C16.4183 17.7778 20 15.0915 20 11.7778C20 8.46407 16.4183 6 12 6Z"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      title: "Collaborative workspace",
      description: "Share context, tasks, and results with your team.",
      tone: "peach",
      icon: (
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="M8 11C9.65685 11 11 9.65685 11 8C11 6.34315 9.65685 5 8 5C6.34315 5 5 6.34315 5 8C5 9.65685 6.34315 11 8 11Z" />
          <path d="M16 10C17.3807 10 18.5 8.88071 18.5 7.5C18.5 6.11929 17.3807 5 16 5C14.6193 5 13.5 6.11929 13.5 7.5C13.5 8.88071 14.6193 10 16 10Z" />
          <path
            d="M4 18C4 15.7909 5.79086 14 8 14H8.5C10.7091 14 12.5 15.7909 12.5 18"
            strokeLinecap="round"
          />
          <path
            d="M13 18C13 16.3431 14.3431 15 16 15H16.3C17.9569 15 19.3 16.3431 19.3 18"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
    {
      title: "Private and secure",
      description: "Clear boundaries for data access and control.",
      tone: "shield",
      icon: (
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path
            d="M12 4L18 6.5V11.5C18 15.4933 15.5198 18.7812 12 20C8.4802 18.7812 6 15.4933 6 11.5V6.5L12 4Z"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
  ];

  const trustCards = [
    {
      title: "Enterprise-ready SSO",
      description: "Sign in securely with work accounts.",
      tone: "rose",
      icon: (
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="M4 8.5H20" strokeLinecap="round" />
          <rect x="4" y="6" width="16" height="12" rx="2.5" />
          <path d="M8 13H12" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      title: "Teamwork and sharing",
      description: "Collaborate with colleagues safely.",
      tone: "peach",
      icon: (
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="M8.5 11C10.433 11 12 9.433 12 7.5C12 5.567 10.433 4 8.5 4C6.567 4 5 5.567 5 7.5C5 9.433 6.567 11 8.5 11Z" />
          <path d="M16.5 12C18.1569 12 19.5 10.6569 19.5 9C19.5 7.34315 18.1569 6 16.5 6C14.8431 6 13.5 7.34315 13.5 9C13.5 10.6569 14.8431 12 16.5 12Z" />
          <path
            d="M4.5 19C4.5 16.5147 6.51472 14.5 9 14.5H9.5C11.9853 14.5 14 16.5147 14 19"
            strokeLinecap="round"
          />
          <path
            d="M13 19C13 17.3431 14.3431 16 16 16H16.7C18.3569 16 19.7 17.3431 19.7 19"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
    {
      title: "Your data stays private",
      description: "Clear access boundaries and device support.",
      tone: "shield",
      icon: (
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="M8 6.5H18C19.1046 6.5 20 7.39543 20 8.5V15.5C20 16.6046 19.1046 17.5 18 17.5H8C6.89543 17.5 6 16.6046 6 15.5V8.5C6 7.39543 6.89543 6.5 8 6.5Z" />
          <path d="M4 9.5V14.5" strokeLinecap="round" />
          <path d="M10 12H16" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  const steps = [
    {
      number: "1",
      title: "Ask",
      description: "Start with a question or task.",
    },
    {
      number: "2",
      title: "Work",
      description: "OpenBot finds knowledge, organizes content, and assists you.",
    },
    {
      number: "3",
      title: "Share",
      description: "Share results and keep the team moving.",
    },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07040c] text-[#f6edf0]">
      <BackgroundDecor />

      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#08050d]/60 backdrop-blur-xl">
        <div className="mx-auto flex h-[82px] w-[min(1280px,calc(100vw-64px))] items-center justify-between gap-6 max-[1280px]:w-[min(1280px,calc(100vw-40px))] max-[720px]:w-[calc(100vw-24px)] max-[720px]:h-[72px]">
          <a
            href="#"
            className="flex items-center gap-3 whitespace-nowrap text-lg font-bold tracking-[-0.02em] text-white"
          >
            <span className="relative h-[34px] w-[34px] rounded-[10px] bg-[linear-gradient(160deg,#fff_0%,#fff1f1_42%,#f2d5d5_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_6px_18px_rgba(255,105,85,0.25)] before:absolute before:inset-[7px_8px_7px_8px] before:rounded-[999px_999px_999px_12px] before:bg-[linear-gradient(180deg,#ff7f68_0%,#d52f2f_100%)] before:shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] before:content-[''] after:absolute after:right-[6px] after:top-[5px] after:h-[9px] after:w-[9px] after:rounded-full after:bg-[#ffe27b] after:shadow-[0_0_12px_rgba(255,226,123,0.9)] after:content-['']" />
            <span>OpenBot</span>
          </a>

          <nav className="ml-auto mr-6 flex items-center gap-[34px] max-[1100px]:hidden">
            <a href="#features" className="text-[15px] text-white/85 transition hover:opacity-80">
              Features
            </a>
            <a href="#use-cases" className="text-[15px] text-white/85 transition hover:opacity-80">
              Use Cases
            </a>
            <a href="#docs" className="text-[15px] text-white/85 transition hover:opacity-80">
              Docs
            </a>
            <a href="#faq" className="text-[15px] text-white/85 transition hover:opacity-80">
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-3 max-[720px]:gap-2.5">
            <button className="inline-flex h-11 items-center gap-2 rounded-[14px] border border-white/10 bg-white/[0.04] px-[14px] text-sm text-white/90 max-[720px]:hidden">
              English
              <span className="h-2 w-2 rotate-45 border-b-[1.5px] border-r-[1.5px] border-current opacity-80" />
            </button>
            <a
              href="#signup"
              className="inline-flex h-[46px] items-center justify-center rounded-[14px] border border-[rgba(239,173,92,0.4)] bg-[linear-gradient(180deg,rgba(186,106,42,0.96)_0%,rgba(150,77,27,0.94)_100%)] px-[22px] text-[15px] font-semibold text-[#fff3e6] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_12px_28px_rgba(141,70,28,0.22)] transition hover:-translate-y-0.5"
            >
              Get Started
            </a>
          </div>
        </div>
      </header>

      <section className="relative z-[1] pb-20 pt-[78px] max-[720px]:pt-[42px]">
        <PlanetGlow />

        <div className="mx-auto grid min-h-[520px] w-[min(1280px,calc(100vw-64px))] grid-cols-[1.25fr_0.95fr] items-start gap-11 max-[1280px]:w-[min(1280px,calc(100vw-40px))] max-[1280px]:gap-7 max-[1100px]:grid-cols-1 max-[720px]:w-[calc(100vw-24px)]">
          <div className="max-w-[640px] pt-16 max-[1100px]:pt-3">
            <div className="mb-[18px] inline-flex items-center gap-2 rounded-full border border-[rgba(255,184,106,0.16)] bg-[linear-gradient(180deg,rgba(88,42,19,0.48),rgba(56,21,16,0.24))] px-4 py-2.5 text-sm text-[#f4c780]">
              <span className="h-2 w-2 rounded-full bg-[#77d887] shadow-[0_0_12px_rgba(119,216,135,0.8)]" />
              <span>Open and ready — no invite code required</span>
            </div>

            <h1 className="max-w-[720px] text-balance text-[clamp(52px,6vw,72px)] font-bold leading-[1.08] tracking-[-0.045em] max-[1280px]:text-[clamp(48px,5vw,64px)] max-[720px]:text-[40px]">
              Your AI workspace for knowledge, collaboration, and everyday work
            </h1>

            <p className="mt-[26px] max-w-[600px] text-2xl leading-[1.55] text-white/70 max-[1280px]:text-lg max-[720px]:text-[17px]">
              Bring chat, knowledge, and workflows together in one clean workspace.
            </p>

            <div className="mt-[34px] flex items-center gap-[14px] max-[720px]:flex-col max-[720px]:items-stretch">
              <a
                href="#signup"
                className="inline-flex h-[58px] items-center justify-center rounded-[16px] border border-[rgba(239,173,92,0.4)] bg-[linear-gradient(180deg,rgba(186,106,42,0.96)_0%,rgba(150,77,27,0.94)_100%)] px-7 text-lg font-semibold text-[#fff3e6] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_12px_28px_rgba(141,70,28,0.22)] transition hover:-translate-y-0.5 max-[720px]:w-full"
              >
                Get Started
              </a>
              <a
                href="#features"
                className="inline-flex h-[58px] items-center justify-center rounded-[16px] border border-white/15 bg-white/[0.02] px-7 text-lg font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:-translate-y-0.5 max-[720px]:w-full"
              >
                Explore Features
              </a>
            </div>
          </div>

          <aside
            id="signup"
            className="relative ml-auto mt-[18px] max-w-[470px] rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(22,12,25,0.9),rgba(15,10,20,0.84))] p-7 shadow-[0_24px_80px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl max-[1100px]:ml-0 max-[1100px]:max-w-full"
          >
            <h2 className="mb-6 mt-1 text-[38px] font-[650] leading-[1.14] tracking-[-0.03em]">
              Create your OpenBot account
            </h2>

            <div className="grid gap-[14px]">
              <input
                type="email"
                placeholder="Enter your email..."
                className="h-[58px] w-full rounded-[15px] border border-white/10 bg-white/[0.03] px-[18px] text-base text-white outline-none placeholder:text-white/35"
              />
              <button className="inline-flex h-[58px] items-center justify-center rounded-[15px] border border-[rgba(239,173,92,0.4)] bg-[linear-gradient(180deg,rgba(186,106,42,0.96)_0%,rgba(150,77,27,0.94)_100%)] px-6 text-lg font-semibold text-[#fff3e6] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_12px_28px_rgba(141,70,28,0.22)] transition hover:-translate-y-0.5">
                Continue
              </button>
            </div>

            <div className="my-2 grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-sm text-white/50 before:block before:h-px before:bg-white/10 before:content-[''] after:block after:h-px after:bg-white/10 after:content-['']">
              OR
            </div>

            <div className="grid grid-cols-2 gap-[14px] max-[720px]:grid-cols-1">
              <button className="inline-flex h-[58px] items-center justify-center gap-3 rounded-[15px] border border-white/15 bg-white/[0.98] px-4 text-base font-semibold text-[#181818] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition hover:-translate-y-0.5">
                <span className="grid h-[22px] w-[22px] place-items-center rounded-full text-sm">
                  G
                </span>
                <span>Google</span>
              </button>
              <button className="inline-flex h-[58px] items-center justify-center gap-3 rounded-[15px] border border-white/15 bg-white/[0.98] px-4 text-base font-semibold text-[#181818] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition hover:-translate-y-0.5">
                <span className="grid h-[22px] w-[22px] place-items-center rounded-full text-sm">
                  ■
                </span>
                <span>Microsoft</span>
              </button>
            </div>

            <p className="pb-0.5 pt-4 text-center text-[15px] text-white/65">
              Have an invite code?
            </p>

            <div className="flex items-center justify-center gap-[14px] text-[13px] text-white/45">
              <a href="#" className="transition hover:text-white/70">
                Telegram
              </a>
              <span>•</span>
              <a href="#" className="transition hover:text-white/70">
                GitHub
              </a>
              <span>•</span>
              <a href="#" className="transition hover:text-white/70">
                Support
              </a>
            </div>
          </aside>
        </div>

        <div
          id="features"
          className="relative z-[2] mx-auto mt-[18px] grid w-[min(1280px,calc(100vw-64px))] grid-cols-4 gap-[18px] max-[1280px]:w-[min(1280px,calc(100vw-40px))] max-[1100px]:grid-cols-1 max-[720px]:w-[calc(100vw-24px)]"
        >
          {featureCards.map((card) => (
            <div
              key={card.title}
              className="min-h-[238px] rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,12,20,0.86),rgba(12,9,17,0.8))] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl"
            >
              <IconChip tone={card.tone}>{card.icon}</IconChip>
              <h3 className="mb-3 text-[31px] font-semibold leading-[1.18] tracking-[-0.025em] max-[1280px]:text-[28px] max-[720px]:text-[26px]">
                {card.title}
              </h3>
              <p className="text-[20px] leading-[1.6] text-white/70 max-[1280px]:text-lg max-[720px]:text-[17px]">
                {card.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="use-cases"
        className="relative z-[2] px-0 pb-6 pt-[106px] max-[1100px]:pt-[72px]"
      >
        <div className="mx-auto w-[min(1280px,calc(100vw-64px))] max-[1280px]:w-[min(1280px,calc(100vw-40px))] max-[720px]:w-[calc(100vw-24px)]">
          <h2 className="text-center text-[56px] font-[650] leading-[1.1] tracking-[-0.04em] max-[1280px]:text-5xl max-[720px]:text-4xl">
            How it works
          </h2>
          <p className="mx-auto mt-[18px] max-w-[720px] text-center text-[22px] leading-[1.6] text-white/70 max-[720px]:text-lg">
            See OpenBot in action.
          </p>

          <div className="mt-14 grid grid-cols-3 gap-[34px] max-[1100px]:grid-cols-1">
            {steps.map((step) => (
              <div
                key={step.number}
                className="grid grid-cols-[56px_1fr] items-start gap-[18px] px-[18px] py-[10px] max-[720px]:grid-cols-[48px_1fr] max-[720px]:px-0"
              >
                <div className="grid h-14 w-14 place-items-center rounded-full border border-white/10 bg-[linear-gradient(180deg,rgba(80,35,40,0.38),rgba(34,17,25,0.38))] text-2xl font-bold text-[#ffe4d4] max-[720px]:h-12 max-[720px]:w-12 max-[720px]:text-xl">
                  {step.number}
                </div>
                <div>
                  <h3 className="mb-2.5 text-[38px] leading-[1.15] tracking-[-0.03em] max-[1280px]:text-[32px] max-[720px]:text-[28px]">
                    {step.title}
                  </h3>
                  <p className="max-w-[300px] text-[21px] leading-[1.6] text-white/70 max-[1280px]:text-lg max-[720px]:text-[17px]">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="docs" className="relative z-[2] px-0 pb-[84px] pt-[72px]">
        <div className="mx-auto w-[min(1280px,calc(100vw-64px))] max-[1280px]:w-[min(1280px,calc(100vw-40px))] max-[720px]:w-[calc(100vw-24px)]">
          <h2 className="text-center text-[56px] font-[650] leading-[1.1] tracking-[-0.04em] max-[1280px]:text-5xl max-[720px]:text-4xl">
            Work securely
          </h2>

          <div className="mt-[30px] border-y border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] py-[52px]">
            <div className="grid grid-cols-3 gap-5 max-[1100px]:grid-cols-1">
              {trustCards.map((card) => (
                <div
                  key={card.title}
                  className="min-h-[168px] rounded-[22px] border border-white/10 bg-[rgba(17,13,20,0.7)] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                >
                  <IconChip tone={card.tone}>{card.icon}</IconChip>
                  <h3 className="mb-3 mt-4 text-[31px] leading-[1.2] tracking-[-0.02em] max-[720px]:text-[26px]">
                    {card.title}
                  </h3>
                  <p className="text-[20px] leading-[1.6] text-white/70 max-[1280px]:text-lg max-[720px]:text-[17px]">
                    {card.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer id="faq" className="relative z-[2] border-t border-white/10 px-0 pb-9 pt-7">
        <div className="mx-auto w-[min(1280px,calc(100vw-64px))] max-[1280px]:w-[min(1280px,calc(100vw-40px))] max-[720px]:w-[calc(100vw-24px)]">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex flex-wrap items-center gap-6">
              <a href="#" className="text-[15px] text-white/75 transition hover:text-white">
                Product
              </a>
              <a href="#features" className="text-[15px] text-white/75 transition hover:text-white">
                Features
              </a>
              <a href="#docs" className="text-[15px] text-white/75 transition hover:text-white">
                Docs
              </a>
              <a href="#faq" className="text-[15px] text-white/75 transition hover:text-white">
                FAQ
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <a href="#" className="text-[15px] text-white/75 transition hover:text-white">
                Privacy Policy
              </a>
              <span className="text-white/25">|</span>
              <a href="#" className="text-[15px] text-white/75 transition hover:text-white">
                Terms of Service
              </a>
              <span className="text-white/25">|</span>
              <a href="#" className="text-[15px] text-white/75 transition hover:text-white">
                English
              </a>
            </div>
          </div>

          <div className="mt-[18px] w-full text-right text-sm text-white/40 max-[1100px]:text-left">
            © 2029 OpenBot. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}

function BackgroundDecor() {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 -z-20 bg-[radial-gradient(circle_at_62%_40%,rgba(255,205,160,0.38),transparent_22%),radial-gradient(circle_at_55%_45%,rgba(255,124,75,0.26),transparent_30%),radial-gradient(circle_at_68%_12%,rgba(154,28,28,0.20),transparent_18%),radial-gradient(circle_at_30%_22%,rgba(97,10,39,0.18),transparent_26%),linear-gradient(180deg,#08050d_0%,#09040d_38%,#06030a_100%)]" />
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:120px_120px] [mask-image:linear-gradient(to_bottom,rgba(255,255,255,0.8),rgba(255,255,255,0.15))]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-90">
        <span className="absolute left-[22%] top-[15%] h-[3px] w-[3px] rounded-full bg-[#ff4c4c] shadow-[0_0_8px_rgba(255,76,76,0.9)]" />
        <span className="absolute left-[71%] top-[20%] h-[3px] w-[3px] rounded-full bg-[#ff9666] shadow-[0_0_8px_rgba(255,150,102,0.8)]" />
        <span className="absolute left-[83%] top-[66%] h-[3px] w-[3px] rounded-full bg-[#ff4747] shadow-[0_0_8px_rgba(255,70,70,0.85)]" />
        <span className="absolute left-[15%] top-[74%] h-[3px] w-[3px] rounded-full bg-[#ff5c5c] shadow-[0_0_8px_rgba(255,92,92,0.78)]" />
        <span className="absolute left-1/2 top-[10%] h-[3px] w-[3px] rounded-full bg-[#ffb48c] shadow-[0_0_8px_rgba(255,180,140,0.7)]" />
        <span className="absolute left-[60%] top-[80%] h-[3px] w-[3px] rounded-full bg-[#ff5555] shadow-[0_0_8px_rgba(255,85,85,0.7)]" />
        <span className="absolute left-[36%] top-[58%] h-[3px] w-[3px] rounded-full bg-[#ff8282] shadow-[0_0_8px_rgba(255,130,130,0.65)]" />
      </div>
    </>
  );
}

function PlanetGlow() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-[420px] z-0 h-[300px] w-[1000px] translate-x-[-6%] opacity-90 max-[1100px]:hidden">
      <div className="absolute bottom-9 left-0 right-0 h-[3px] rotate-[-12deg] rounded-full bg-[linear-gradient(90deg,rgba(255,180,120,0)_0%,rgba(255,208,170,0.95)_45%,rgba(255,160,110,0.5)_70%,rgba(255,160,110,0.02)_100%)] shadow-[0_0_24px_rgba(255,188,130,0.55),0_0_60px_rgba(255,138,87,0.3)]" />
      <div className="absolute bottom-[-52px] left-[150px] right-20 h-[220px] rotate-[-8deg] rounded-[50%] bg-[radial-gradient(ellipse_at_top,rgba(255,186,130,0.28)_0%,rgba(255,130,90,0.12)_35%,rgba(255,110,72,0.02)_70%,transparent_75%)] blur-[18px]" />
    </div>
  );
}

function IconChip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "rose" | "green" | "peach" | "shield";
}) {
  const tones: Record<string, string> = {
    rose: "text-[#ffcbc9] bg-[linear-gradient(180deg,rgba(120,55,60,0.32),rgba(64,25,30,0.3))]",
    green: "text-[#99f6af] bg-[linear-gradient(180deg,rgba(37,83,61,0.32),rgba(23,48,41,0.3))]",
    peach: "text-[#ffd7d7] bg-[linear-gradient(180deg,rgba(106,64,64,0.32),rgba(56,30,34,0.3))]",
    shield: "text-[#b5ffa2] bg-[linear-gradient(180deg,rgba(63,84,35,0.28),rgba(31,42,25,0.3))]",
  };

  return (
    <div
      className={`mb-[22px] inline-flex h-[54px] w-[54px] items-center justify-center rounded-2xl border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
