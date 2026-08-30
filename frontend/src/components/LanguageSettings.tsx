import { Check, Languages } from "@/components/icons";
import { SettingsSection, DataRow } from "@/components/SettingsPrimitives";
import { useI18n, LOCALE_NAMES, SELECTABLE_LOCALES, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// The interface language, and the only place it can be changed.
//
// ── Why a segmented control and not a dropdown ──────────────────────────────
//
// The person most likely to need this control is the one whose language was
// guessed wrong — which means they are looking at an interface they cannot read,
// hunting for the way out. A dropdown shows one language until it is opened, so the
// option they want is hidden behind a click on a label that means nothing to them.
// Both options being on screen at once means the word "Français" is visible from
// across the page, and the language names are each written in their own language for
// the same reason: "French" is no help to somebody who does not read English.
//
// It is also why the row's icon is a glyph rather than a flag. A flag names a
// country, and French is not a country — a tricolour here would be quietly wrong for
// every French speaker outside France, which is most of them.

export function LanguageSettings() {
  const { locale, setLocale, t } = useI18n();

  return (
    <SettingsSection
      id="language-heading"
      title={t("settings.language.title")}
      description={t("settings.language.description")}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <DataRow
          icon={Languages}
          title={t("settings.language.title")}
          description={t("settings.language.description")}
        >
          {/* radiogroup rather than a row of buttons: this is one setting with two
              mutually exclusive values, and a screen reader should say "2 of 2
              selected" rather than reading two unrelated buttons. */}
          <div role="radiogroup" aria-labelledby="language-heading" className="flex gap-1.5">
            {SELECTABLE_LOCALES.map((option: Locale) => {
              const active = option === locale;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  // The language names are NOT translated — see the note above. The
                  // `lang` attribute is what stops a screen reader pronouncing
                  // "Français" with English phonetics while the page is in English,
                  // which is WCAG 3.1.2 (Language of Parts) and the reason this
                  // attribute exists on individual elements at all.
                  lang={option}
                  onClick={() => setLocale(option)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
                    active
                      ? "border-primary bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] font-medium text-foreground"
                      : "text-muted-foreground hover-scrim hover:text-foreground"
                  )}
                >
                  {/* The tick is RENDERED only when selected, not hidden with
                      opacity. An invisible tick still occupies its width, so the
                      unselected option sat in a box padded out for something that was
                      not there, and the pair read as two half-empty controls rather
                      than as a label and a chosen label. Each option now hugs its own
                      word, and the selected one grows to make room for the mark.

                      The tick also carries the selected state independently of the
                      colour, so the control reads correctly to somebody who cannot
                      distinguish the two backgrounds. Presence does that job at least
                      as well as full opacity did, and `aria-checked` on the button is
                      what carries it to assistive tech either way. */}
                  {active && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  {LOCALE_NAMES[option]}
                </button>
              );
            })}
          </div>
        </DataRow>
      </div>
    </SettingsSection>
  );
}
