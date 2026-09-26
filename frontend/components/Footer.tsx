import { EXTERNAL_LINKS } from "@/lib/links";

// Issue #140: the footer is the only chrome on every page, so it is where a
// reader looks for the docs, the source and a way to reach the maintainers.
export default function Footer() {
  return (
    <footer className="border-t border-[#1a2535] py-8 text-center text-sm text-slate-600">
      <nav aria-label="Site resources" className="max-w-6xl mx-auto px-6">
        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {EXTERNAL_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                title={link.description}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-slate-200 hover:underline underline-offset-4 transition-colors"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="mt-4">Quorum &middot; Built for the Stellar Ecosystem &middot; Drips Wave Contributor &middot; MIT License</p>
    </footer>
  );
}
