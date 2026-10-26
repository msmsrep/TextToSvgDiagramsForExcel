# Microsoft Store の掲載素材

Partner Center（Store ID `9N78SZM66WM9`）に登録する掲載情報と画像。設計は [docs/desktop-design.md](../../docs/desktop-design.md) §9.4。

| ファイル | Partner Center での入力先 |
|---|---|
| [listing.en.md](./listing.en.md) / [listing.ja.md](./listing.ja.md) | ストア掲載情報（英語 / 日本語）の説明・機能・キーワード・キャプションなど |
| [certification-notes.md](./certification-notes.md) | 申請オプション →「認定の注意事項」と、制限付き機能（`runFullTrust`）の理由 |
| `images/screenshots/en/*.png` / `images/screenshots/ja/*.png` | 各言語の「スクリーンショット（デスクトップ）」。1920 × 1080 |
| `images/promo/hero-16x9.png` | 「16:9 スーパー ヒーロー アート」。3840 × 2160。文字を入れない（ストアが製品名を重ねるため） |
| `images/promo/poster-9x16.en.png` / `poster-9x16.ja.png` | 各言語の「9:16 ポスター アート」。1440 × 2160 |
| `images/promo/box-1x1.en.png` / `box-1x1.ja.png` | 各言語の「1:1 ボックス アート」。2160 × 2160 |
| `images/promo/store-logo-300.png` | 「ストア ロゴ」（1:1）。300 × 300 |

- スクリーンショットは、MSIX 外の Debug ビルドと Excel 16 で撮った実際の画面です（Excel はリボンとステータス バーを隠し、言語に左右されない見た目にしています）。画面が変わったら撮り直してください。
- プロモーション画像の図は、アプリの描画エンジンで描いたものです。
- プライバシー ポリシーの URL は紹介ページの `#privacy` で、デスクトップ版の項も含みます。
