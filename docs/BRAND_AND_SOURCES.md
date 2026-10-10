# Brand and source notes

The application interprets the visual identity of [Schach Engineers](https://www.schachengineers.com/) for a task-management workspace. Website colors, typography declarations, and original image assets were inspected on **10 October 2026**. Sample companies, employees, projects, and task data in the demo are fictional.

## Verified palette

These values come from the website's [compiled CSS](https://www.schachengineers.com/_astro/seo.Dw9_lCxO.css), not from estimated screenshot colors.

| Role | Color | Source evidence |
| --- | --- | --- |
| Primary orange | `#F97316` | Literal CSS hex; `orange-500` uses RGB 249, 115, 22 |
| Deep charcoal | `#09090B` | Homepage theme color; `zinc-950` utility |
| Raised dark surface | `#18181B` | `zinc-900` utility |
| Subtle dark border | `#27272A` | `zinc-800` utility |
| Foreground | `#FAFAFA` | Root foreground HSL 0, 0%, 98% |
| Muted foreground | `#A1A1AA` | `text-zinc-400` uses RGB 161, 161, 170 |

The site's rounded HSL primary token converts to approximately `#F97015`; the app uses its repeated, explicit `#F97316` utility accent. Light content surfaces, spacing, charts, and workflow layouts are application design decisions. Status labels and icons accompany color.

## Logo and fonts

The logo is an unchanged Schach website asset with a transparent background and white lettering. The [original 745 × 280 WebP](https://www.schachengineers.com/_astro/schach-logo-transparent.DJf3yJAo_Z1dAzOj.webp) is intended for a dark surface. The logo and company name are separate from the open-source font licenses below.

| Typeface | Website use | Downloaded source | Declared weights |
| --- | --- | --- | --- |
| Chivo | Headings | [Original WOFF2](https://www.schachengineers.com/_astro/fonts/d51f2258800ce6b1.woff2) | 400–900, normal |
| IBM Plex Sans | Body and controls | [Original WOFF2](https://www.schachengineers.com/_astro/fonts/2eb6e0e4fc33dd24.woff2) | 400–700, normal |

Each is a Latin subset; retain a system fallback for other scripts. Regular and medium IBM Plex Sans use the same variable font. The website also identifies JetBrains Mono for technical labels; that font was not downloaded for this application.

Both supplied font families are licensed under the **SIL Open Font License 1.1**. Preserve the full notices when distributing the fonts. Chivo's notice credits the 2019 Chivo Project Authors. IBM Plex Sans credits IBM Corp. and reserves the name “Plex.” Source notices: [Chivo OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/chivo/OFL.txt), [IBM Plex Sans OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsans/OFL.txt). Original Chivo project: [Omnibus-Type/Chivo](https://github.com/Omnibus-Type/Chivo).

The font binaries and full notices are included under `frontend/public/fonts/` so the application can serve them locally.

## Technical primary sources

- [Encore + GORM](https://encore.dev/docs/go/how-to/atlas-gorm): Encore-managed PostgreSQL connection passed to GORM through `Stdlib()`.
- [GORM PostgreSQL connections](https://gorm.io/docs/connecting_to_the_database.html): existing `database/sql` connection support.
- [Encore raw endpoints](https://encore.dev/docs/go/primitives/raw-endpoints): standard Go HTTP handler integration.
- [Encore Cron Jobs](https://encore.dev/docs/go/primitives/cron-jobs): schedules, idempotency, and local execution limitations.
- [Encore typed configuration](https://encore.dev/docs/go/develop/config), [secrets](https://encore.dev/docs/go/primitives/secrets), and [request metadata](https://pkg.go.dev/encore.dev#Request): service configuration and cron-trigger identification.
- [Encore Docker builds](https://encore.dev/docs/self-host/build) and [infrastructure configuration](https://encore.dev/docs/self-host/configure-infra): self-hosted builds, database/secret wiring, and private endpoint authentication.
- [PostgreSQL backup](https://www.postgresql.org/docs/current/backup-dump.html) and [restore](https://www.postgresql.org/docs/current/app-pgrestore.html): operational backup procedures.

The checked upstream versions were Encore CLI `1.58.6`, Encore Go SDK `1.57.13`, GORM `1.31.2`, and GORM PostgreSQL driver `1.6.3`. The driver requires Go `1.25.0`. Dependency files in the package identify the actual pinned application versions; the verification record identifies which commands were executed. These research checks do not independently certify a deployment.
