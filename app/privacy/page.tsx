import Link from "next/link";
import {
  APP_TITLE,
  PRIVACY_CONTACT,
  SERVER_WORDS_MAX_STORED,
} from "@/lib/constants";

/** 開示の層 3 — 法務上の足り。トーンは事務的・短く。 */
export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <div className="privacy-card">
        <p className="privacy-eyebrow">about this space</p>
        <h1 className="privacy-title">この場について</h1>

        <section>
          <h2>この場は何か</h2>
          <p>
            {APP_TITLE}
            は、「存在の負荷を少し下げられるか」を試す小さな実験です。利用者数や滞在時間を競わせる場ではありません。
          </p>
        </section>

        <section>
          <h2>他の利用者に見えるもの</h2>
          <p>
            いまおおよそ何人いるか（気配）だけです。名前、アイコン、プロフィール、誰が書いたかは表示しません。他の利用者が置いた言葉も、あなたの画面には出ません。
          </p>
        </section>

        <section>
          <h2>場をつくっている人に見えるもの</h2>
          <p>
            あなたが置いた言葉の文面です。画面では自分にだけ見えていても、サーバーに送られ、場をつくっている人があとから読むことがあります。評価や返信のためではなく、場の空気を観察し、設計を直すためです。
          </p>
          <p>
            また、おおよその利用の様子（いつ頃使われたか、おおよその人数など）を、個人を特定しない形で見ています。名前やメールアドレスの登録はありません。
          </p>
        </section>

        <section>
          <h2>目的</h2>
          <p>
            補正や自己演出が少ない空気が、実際に感じられるかを観察するためです。第三者への提供や広告目的では使いません。
          </p>
        </section>

        <section>
          <h2>保管と削除</h2>
          <p>
            置いた言葉は観察用にサーバーに保存します。おおよそ{" "}
            {SERVER_WORDS_MAX_STORED.toLocaleString("ja-JP")}
            件を超えた分から、古いもの順に削除します。画面に漂う言葉（最大
            40 件）はブラウザ内だけで、リロードすると消えます。
          </p>
        </section>

        <section>
          <h2>お問い合わせ</h2>
          <p>
            取扱いについての質問は、運営者までご連絡ください。
            <br />
            {PRIVACY_CONTACT ? (
              <a href={`mailto:${PRIVACY_CONTACT}`} className="privacy-contact">
                {PRIVACY_CONTACT}
              </a>
            ) : (
              <span className="privacy-contact">
                連絡先は公開時に本ページへ記載します
              </span>
            )}
          </p>
        </section>

        <p className="privacy-back">
          <Link href="/">場に戻る</Link>
        </p>
      </div>
    </main>
  );
}
