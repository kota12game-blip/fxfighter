# VIRTUAL MARKET セットアップ手順（約30分）

## 1\. Twelve Data（価格）

1. https://twelvedata.com でアカウント作成（無料）
2. ダッシュボードの API Keys からキーをコピー


## 2\. Supabase（ログイン・保存・フレンド）

1. https://supabase.com でプロジェクトを新規作成
2. 左メニュー **SQL Editor** → このフォルダの `supabase.sql` の中身を貼って **Run**
3. **Authentication → Sign In / Providers** で次の2つを有効化

   * **Allow anonymous sign-ins**（ゲストログイン用）
   * **Allow manual linking**（ゲストをGoogleと連携する用）
   * **Google** プロバイダ
（Google Cloud ConsoleでOAuthクライアントIDを作り、Client ID/Secretを貼る。画面の案内に従えばOK）
4. **Project Settings → API** から `Project URL` と `anon public key` をコピー

## 3\. Vercel（公開）

1. このフォルダをGitHubのリポジトリにアップロード
2. https://vercel.com にGitHubでログイン → **Add New → Project** → そのリポジトリを選ぶ
3. **Environment Variables** に `.env.example` の3つを登録 → **Deploy**
4. 発行されたURL（https://xxxx.vercel.app）を、Supabaseの
**Authentication → URL Configuration → Site URL / Redirect URLs** に登録
5. iPhoneのSafariでURLを開き、共有ボタン →「ホーム画面に追加」

## 注意

* 価格は最大2分遅れ（無料枠の1日800クレジット対策）。秒単位にしたい場合はTwelve Dataの有料プランに変更。
* 友達用の構成のため、売買計算は端末側です。公開する場合はサーバー側判定への作り直しとデータ提供元の再配信条件の確認が必要。
* 土日は為替市場が閉まるため価格が止まります。

## 友達の招待

アプリの「ランキング」画面の【招待リンクをコピー】でURLを送ってください。相手は開くだけ（ゲストでOK）でフレンドになります。

