# Live Codex image and Listing smoke report

- Date: 2026-08-24
- Environment: Codex built-in image generation plus project-local deterministic CLIs
- Fixture: fictional, unbranded blank aluminum sign
- Marketplace/language: Amazon.com / en-US
- Approval status: all approvals below are simulated test-fixture approvals, not approvals for a user's commercial product

## Confirmed fixture facts

- Product: one blank aluminum sign
- Face: landscape, 12 inches wide × 8 inches high, physical ratio 3:2
- Appearance: brushed silver
- Visible construction: four front-visible circular mounting holes
- Excluded/unknown: back construction, included hardware, installation method, certification, performance, and use claims

The fixture project is stored under the Git-ignored `evals/live-smoke/artifacts/fixture-aluminum-sign/` directory. `facts.json`, `assets.json`, and `project.md` are the file-first state; no WebUI, HTTP server, queue, or worker was used.

## Main-image generation and Product Master

The built-in Codex image generator produced actual PNG files. Every selected result was copied into the fixture workspace, decoded, hashed, checked with `scripts/validate-image.js`, and visually inspected at the exact saved path.

The initial 95% value was exercised as a strict project target. Attempts v1-v4 were preserved and rejected rather than silently approved:

| Version | Dominant occupancy | Relative 3:2 error | Decision |
| --- | ---: | ---: | --- |
| v1 | 85.68% | 2.13% | reject: occupancy and ratio |
| v2 | 88.93% | 5.52% | reject: occupancy and ratio |
| v3 | 92.11% | 7.56% | reject: occupancy and ratio |
| v4 | 88.54% | 5.43% | reject: occupancy and ratio |

This live run prompted a verified requirement correction: Amazon.com's general main-image baseline is 85% occupancy, while a stricter category or explicit user/project target such as 95% is scoped rather than global. The validator now defaults to 85% and accepts a stricter `--min-occupancy` override. Sources are recorded in `assets/rules/amazon-us-defaults.json`.

### Approved fixture main: v5

- Saved path: `evals/live-smoke/artifacts/fixture-aluminum-sign/assets/main-v5.png`
- Media type: `image/png`
- Byte size: 1,339,694
- SHA-256: `9ab146eb431de772cdb5dfd7f5bd41fc864692493715e57e9f0672f32ff2e00f`
- Raster: 1254 × 1254
- Detected product bounds: 1152 × 772 at (51, 224)
- Dominant occupancy: 91.866%
- Background: pass
- Fully visible: pass
- Detected physical ratio: 1.49223
- Relative error from 3:2: 0.518%
- Deterministic result under Amazon.com base 85%: pass
- Semantic saved-file inspection: one blank brushed-silver sign; four front-visible holes; no text, brand, package, accessories, people, or watermark; pass for this fictional fixture

The fixture records explicit approval of this saved hash and locks Product Master v1. The uncropped v5 is used; the exploratory whitespace-cropped artifact is not approved or delivered.

## Real secondary image and deterministic copy

The approved main v5 was supplied as the first identity reference to a separate built-in generation call. The model generated a real size/specification base with no text. Critical dimensions were then added by `scripts/compose-overlay.js` from approved fact IDs and the final composite was decoded and visually inspected.

- Base saved path: `evals/live-smoke/artifacts/fixture-aluminum-sign/assets/secondary-size-base-v1.png`
- Approved final path: `evals/live-smoke/artifacts/fixture-aluminum-sign/assets/secondary-size-approved-v3.png`
- Media type: `image/png`
- Byte size: 1,927,568
- SHA-256: `54c0d3ff05c3b310fc1335a337c153752ea93451aad3e2e60e9eed6a377c0996`
- Overlay manifest: `secondary-size-approved-v3.png.overlay.json`
- Manifest SHA-256: `b4a5802447fa5692b7c71b66507370d1d3fc3dba77a49ce5031365718d02ff2f`
- Exact copy: `12 in wide`; `8 in high`
- Fact references: `dimensions.width`; `dimensions.height`
- Final font: Arial system file, SHA-256 `c9b76220a5be42ead4733611e417cd65c5fd8aeaa33eb56576ac378a37d130a1`
- Recorded fallback: Interva -> Arial for clearer e-commerce typography
- Product Master binding: v1
- Semantic inspection: product identity and four-hole configuration preserved; labels readable and in bounds; pass

The first overlay inspection exposed that librsvg ignored embedded `@font-face` data even though the manifest named the requested file. A failing test reproduced identical pixel hashes for Arial and Times. The composer now converts glyphs from the selected font bytes into SVG paths with Fontkit; the regression test proves different selected fonts produce different output pixels.

## Listing validation

The complete grounded Listing is saved as `listing.json` and `listing.md` in the ignored fixture project. It contains Title, Item Highlights, exactly five `[HEADING] Body` Bullets, Description, Backend Search Terms, Special Features, attributes, and claim references.

- Product Master: v1
- Listing: v1
- Title: 60 characters
- Item Highlights: 78 characters
- Bullet characters: 82, 76, 60, 74, 64; combined 356
- Description: 177 characters
- Backend Search Terms: 72 UTF-8 bytes
- Validation: `PASS_WITH_WARNINGS`
- Unverified fields: `special_features`, `attributes`
- Schema authorization scope: Amazon.com / METAL_SIGN / Product Master v1 / Listing v1
- `upload_ready`: `false`

No unsupported back, installation, hardware, durability, compatibility, certification, or performance claim appears.

## Delivery integrity

`scripts/build-delivery.js` built and re-opened the ZIP, verified each artifact hash, and included only the two selected images and two Listing files.

- Manifest: `evals/live-smoke/artifacts/delivery-v1/delivery-manifest.json`
- Manifest SHA-256: `76b14e861e46b5be9c86ffaf2bf4a2ecf458dac477ad10c0726d43ae86427eca`
- ZIP: `evals/live-smoke/artifacts/delivery-v1/delivery.zip`
- ZIP byte size: 3,256,657
- ZIP SHA-256: `67b9813e050098eedb489185f062fcf026d241d497f4f26b6477c5d127fc964c`
- Approval ID: `fixture-final-approval-1`
- Bundle label state: Schema unverified; not directly uploadable

## Approved generation prompts

### Main v5

```text
Use case: compositing
Asset type: Amazon.com main product image acceptance fixture
Input images: Image 1 is the product identity and material reference. Image 2 is a strict layout/geometry reference only.
Primary request: render the brushed-silver aluminum sign from Image 1 using exactly the outer silhouette, scale, canvas, and four-hole positions shown in Image 2.
Identity invariants from Image 1: same blank silver aluminum face, realistic fine brushed-metal texture, exactly four circular mounting holes, straight-on view, one product only.
Geometry invariants from Image 2: square canvas; product outer box exactly 1200 × 800 within a 1250 × 1250 canvas; exact 3:2 sign face; all product edges visible; thin white margins; hole positions follow the guide.
Scene/backdrop: pure #FFFFFF with no floor, no shadow, no gray halo outside the exact product silhouette.
Constraints: Image 2 controls geometry only and Image 1 controls product appearance only; no text, logo, brand, packaging, accessories, props, people, watermark, perspective, tilt, or extra holes.
```

### Secondary size/spec base

```text
Use case: product-mockup
Asset type: Amazon secondary size/specification image base
Input images: Image 1 is the locked test Product Master identity reference.
Primary request: create a clean size/specification card base featuring the exact same blank brushed-silver aluminum sign from Image 1.
Scene/backdrop: very light neutral warm-gray studio background with subtle depth, no environmental props.
Composition/framing: square canvas; centered product at about 72% width; clear space above and left for deterministic dimensions.
Constraints: preserve Product Master identity exactly; no text, numbers, arrows, labels, logo, brand, packaging, accessories, extra holes, people, watermark, back construction, or installation hardware.
```

## Limitations

- This is evidence that the Skill invokes real image generation and correctly gates, inspects, versions, and packages outputs. It is not evidence that a fictional AI-rendered product photograph may be uploaded for a real ASIN.
- A real commercial run must use the seller's actual product/reference assets and current product-type Schema.
- The 85% value is a dated Amazon.com base fallback. Current marketplace/category guidance and stricter explicit user requirements still take precedence.
