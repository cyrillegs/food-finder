import { useTranslations } from 'next-intl';
import type { RecentSearchEntry } from '@/lib/api-client';

type RecentSearchesPanelProps = {
  searches: RecentSearchEntry[];
  onSelect: (query: string) => void;
  // Whether a user is currently logged in - GET /api/searches/recent now
  // requires one (see recent-searches.route.ts), so there's no shared
  // anonymous history to show anymore. SearchExperience doesn't even fetch
  // `searches` while logged out (see there); this flag is what tells this
  // component to show a "log in to see your history" prompt instead of the
  // old empty-history message, which would otherwise be indistinguishable
  // from "you're logged in but haven't searched yet".
  isLoggedIn: boolean;
  // Matches SearchBox's own isHero prop so this panel lines up under the
  // search box at the same width in both the hero (pre-search) and compact
  // (post-search) layouts - see SearchExperience.tsx.
  isHero?: boolean;
};

// Purely presentational, same as ResultsGrid: SearchExperience owns fetching
// and re-fetching (on mount and after each new search) and just hands the
// current list down. Clicking an entry calls back into the same handler
// SearchExperience wires to SearchBox's own submit, so a click re-runs a
// real search rather than only filling the input's text.
//
// Deliberately always rendered, in both hero and post-search layouts, for a
// logged-in user, rather than only appearing once there's history: the
// panel is most useful right where the user hasn't typed anything yet (a
// one-click repeat of a past search), and it's that user's own history, not
// something scoped to "this visit" - hiding it until it has content would
// misrepresent it as newer than it is. The empty state below keeps that
// always-visible choice honest rather than confusing.
export function RecentSearchesPanel({ searches, onSelect, isLoggedIn, isHero = false }: RecentSearchesPanelProps) {
  const t = useTranslations('recentSearches');

  return (
    <section aria-label={t('heading')} className={isHero ? 'w-full max-w-2xl' : 'w-full max-w-3xl'}>
      <h2 className="mb-2 text-sm font-medium text-muted">{t('heading')}</h2>
      {!isLoggedIn ? (
        <p className="text-sm text-muted">{t('loginPromptMessage')}</p>
      ) : searches.length === 0 ? (
        <p className="text-sm text-muted">{t('emptyMessage')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {searches.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onSelect(entry.query)}
                className="border border-ink/20 px-3 py-1.5 text-sm text-ink transition-colors hover:border-ink hover:bg-ink/5"
              >
                {entry.query}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
