# Firebase セットアップ手順（v1.5以降）

## STEP 1：Firebaseプロジェクト作成

1. [console.firebase.google.com](https://console.firebase.google.com) を開く
2. 「プロジェクトを追加」をクリック
3. プロジェクト名：「生産反数管理」
4. Google アナリティクス：オフでOK
5. 「プロジェクトを作成」

---

## STEP 2：Google認証を有効化

1. 左メニュー「構築」→「Authentication」
2. 「始める」をクリック
3. 「Sign-in method」タブ → 「Google」をクリック
4. 有効にする → 「保存」

---

## STEP 3：Firestoreデータベース作成

1. 左メニュー「構築」→「Firestore Database」
2. 「データベースの作成」
3. ロケーション：**asia-northeast1（東京）** を選択
4. セキュリティルール：「テストモードで開始」を選択 → 「作成」

### セキュリティルールの設定（重要）

作成後、「ルール」タブで以下に書き換えて「公開」：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /entries/{entryId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

これで「Googleでサインイン済みのユーザーだけが読み書きできる」になります。

---

## STEP 4：Firebaseの設定値をコピー

1. プロジェクトのトップページ（歯車アイコン → 「プロジェクトの設定」）
2. 「マイアプリ」セクション → 「ウェブアプリを追加」（`</>`アイコン）
3. アプリのニックネーム：「生産反数管理Web」
4. Firebase Hostingは不要 → 「アプリを登録」
5. 以下のような設定値が表示される：

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "xxxx.firebaseapp.com",
  projectId: "xxxx",
  storageBucket: "xxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123...",
};
```

---

## STEP 5：config.js に貼り付け

`js/config.js` を以下のように書き換える：

```javascript
var CONFIG = {
  firebase: {
    apiKey:            'AIza...',
    authDomain:        'xxxx.firebaseapp.com',
    projectId:         'xxxx',
    storageBucket:     'xxxx.appspot.com',
    messagingSenderId: '123456789',
    appId:             '1:123...',
  }
};
```

---

## STEP 6：承認済みドメインを追加

1. Firebase Console → Authentication → 「Settings」タブ
2. 「承認済みドメイン」に追加：
   ```
   708neo708neo-prog.github.io
   ```

---

## STEP 7：GitHubにpush

```bash
cd /Users/yamamotonaoya/Desktop/production-tracker
git add js/config.js index.html js/app.js css/style.css
git commit -m "Migrate to Firebase v1.5"
git push
```

---

## スタッフの追加方法

Firebase Authentication で管理：
- 特にホワイトリスト設定がない場合、Googleアカウントを持つ全員がサインイン可能
- 制限が必要な場合は Firestore のセキュリティルールで対応
