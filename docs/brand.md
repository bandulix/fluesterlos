# Thai.GER corporate identity

Measured from the live site on 25 October 2026. Nothing in this palette was chosen to “look like” the brand. Each value is either a pixel in the logo file, a custom property in the homepage CSS, or a mix of two of those.

Sources:

- Homepage HTML: `https://thaigersupporters.info/`
- Logo, as served: `https://thaigersupporters.info/wp-content/uploads/2025/08/EmbeddedImage.png`
- The same file in this repo: `web/public/brand/thaiger/logo.png`

## Logo file

| | |
| --- | --- |
| Format | PNG, 1280×719, 8-bit RGB, no alpha |
| sha256 of the URL | `a70f2e3de69ad998b250b942d2d024144fc01e1e7a4933eec784cbd745a803ce` |
| sha256 of `web/public/brand/thaiger/logo.png` | `a70f2e3de69ad998b250b942d2d024144fc01e1e7a4933eec784cbd745a803ce` |

The two hashes match. The file is not cropped, recolored, masked, or traced.

The artwork is the circular tiger mark (a red jersey with gold trim, a football, and the Thai and German flags) plus the words “Thai.GER” and “Supporters Bangkok”. Corners and edges of the file are `#ffffff`. The non-white artwork starts 19px from the top, 20px from the right and 23px from the bottom, and it touches the left edge of the file. Clear space has to sit outside the image.

On the homepage the logo is the site logo (`img.custom-logo`, alt “ThaiGer Supporters Bangkok Logo”), shown at 202×113 inside a header group whose padding is `clamp(1.5rem, 5vw, 2rem)`. The page background behind that header is the theme background, `#ffffff`, so the file’s own white disappears into the page.

## Colours taken from the logo

Counted across every pixel. The value is the most common exact colour in that family.

| Role | Hex | Pixels | Where it sits |
| --- | --- | --- | --- |
| Field | `#ffffff` | corners, edges, and 32,227 of 57,280 samples on a 4px grid | The file’s background |
| Ink | `#231f20` | 147,420 | Wordmark and tiger outline. The centre pixel `(640, 359)` is this colour |
| Jersey red | `#c2272d` | 46,314 | The red of the jersey and the Thai flag |
| Gold | `#f6911f` | 4,900 | Gold trim and the German flag |
| Mid gray | `#959595` | 14,773 | Antialiased gray in the mark |
| Light gray | `#c1c1c1` | 588 | Lighter gray in the same mark |

`#959595` on the ink is 5.44:1, but on a card lifted 10% toward white it falls to 4.04:1. Muted text uses the logo’s lighter gray `#c1c1c1` (6.72:1 on that card, 9.05:1 on the ink).

## Colours taken from the site

From the homepage `:root` custom properties (the Extendable theme presets that this site actually names), and from inline styles that paint them.

| Token | Hex | Where it is used |
| --- | --- | --- |
| `--wp--preset--color--background` | `#ffffff` | Page background. Also the donate button (`background-color:#fcfcfc` is a near-white one-off on that link) |
| `--wp--preset--color--foreground` | `#000000` | Default text token |
| `--wp--preset--color--foreground-alt` | `#333333` | Secondary text token |
| `--wp--preset--color--primary` | `#0B51C2` | Heading colour. Two `h3` elements use `has-primary-color` |
| `--wp--preset--color--tertiary` | `#F9FAFE` | Card and section fill (`has-tertiary-background-color`, including the About band) |
| `--wp--preset--color--custom-color-1` | `#b52a2e` | Filled brand red. Instagram, LinkedIn and Facebook marks are `color:#ffffff; background-color:#b52a2e` |
| `--wp--preset--color--secondary` | `#c4ff47` | Defined once, not painted on the homepage. Not used |

WordPress default palette entries (vivid cyan, pale pink, and the rest) are present because the theme dumps them. They are not Thai.GER colours and they are not in the UI.

Contrast that decided the pairing:

| Pair | Ratio | Use |
| --- | --- | --- |
| `#ffffff` on `#b52a2e` | 6.30:1 | Filled buttons and the final-minute digits |
| `#ffffff` on `#c2272d` | 5.80:1 | The logo red passes too. UI red is the site token `#b52a2e`, which is the red the site actually paints |
| `#231f20` on `#f6911f` | 6.98:1 | Ink on gold (medals, “You”, funded) |
| `#f6911f` on `#231f20` | 6.98:1 | Gold figures on the room |
| `#f6911f` on `#393536` | 5.18:1 | Gold figures on a card |
| `#0B51C2` on `#ffffff` | 7.07:1 | Titles on the white plate |
| `#0B51C2` on `#231f20` | 2.31:1 | Blue is not used on the dark room |
| `#b52a2e` on `#231f20` | 2.59:1 | Red text is not put on the ink. The final minute sits on a `#ffffff` plate. The phone’s last minute turns the timer into a `#b52a2e` pill with `#ffffff` type |
| `#ffffff` on `#231f20` | 16.30:1 | Body text on the room |
| `#333333` on `#ffffff` | 12.63:1 | Secondary text on the white plates |

## Derived surfaces

These are not new hues. They are the logo ink mixed with the logo white, so a card can sit above the room and still be the same black.

| Token | Hex | Mix |
| --- | --- | --- |
| `--bg`, `--engager-bg`, `--ink` | `#231f20` | Logo ink, unmixed |
| `--card-nested` | `#302c2d` | 6% `#ffffff` into `#231f20` |
| `--card`, `--panel` | `#393536` | 10% `#ffffff` into `#231f20` |
| `--border` | `#535051` | 22% `#ffffff` into `#231f20` |

## Type

- **Inter** is the face the homepage loads (`fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700`, the GiveWP campaign stylesheet). UI text uses the self-hosted Inter already in `web/public/brand/thaiger/`.
- **Oswald** is a theme `@font-face` and the preset `--wp--preset--font-family--oswald`. The homepage does not put that class on body copy. Display figures use it because it is the condensed face in the theme’s own font set.
- **Noto Sans Thai** is for Thai lines. It is not on the marketing site. It stays so the room can read Thai.

## How the app uses it

The values live in `web/public/themes/thaiger.css` under `[data-theme="thaiger"]`. Screens read them through variables (`--accent`, `--button-bg`, `--paper`, `--ink`, and the rest).

- The room, the phone and the host desk stay on the ink, so a projector and a dark hall are not a white page.
- The logo sits on a `#ffffff` plate: guest header, host top bar, big-screen brand bar, the join card, and the stats brand bar. Padding on that plate is the clear space. The image is not given a filter, a mask, or a crop.
- One filled action per screen is `#b52a2e` with `#ffffff` type (“Bid ฿12,000”, “Pay ฿5,000”). Outlined actions are `#f6911f`.
- The hero number and the goal bar are `#f6911f`.
- Titles on the white plates are `#0B51C2`, the site’s heading colour.
- The final minute is `#b52a2e` on `#ffffff`, because the red does not pass on the ink.

## Motifs that stay inside the logo

The tiger, the jersey stripes, the football, and the two flags are already in the logo file. The interface does not redraw them. Red, gold, black and white are how those motifs show up in the rest of the product.
