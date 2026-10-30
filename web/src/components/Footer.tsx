import { NAV_LINKS } from '../content';

export function Footer() {
  return (
    <footer id="footer" className="scroll-mt-16 border-t border-white/5 px-6 py-16">
      <div className="mx-auto w-full max-w-content">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div>
            <a
              href="#hero"
              className="focus-ring flex items-center gap-2 rounded-full text-sm font-medium tracking-tight"
            >
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
              ReproFlow
            </a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-mist-500">
              Record a browser bug once, verify it locally, and file an issue with the evidence
              attached.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="focus-ring rounded-full text-sm text-mist-500 transition-colors hover:text-mist-100"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/5 pt-6 text-xs text-mist-700 md:flex-row md:items-center md:justify-between">
          <span>© {new Date().getFullYear()} ReproFlow</span>
          <span>Not affiliated with GitHub. Nothing is uploaded until you confirm it.</span>
        </div>
      </div>
    </footer>
  );
}
