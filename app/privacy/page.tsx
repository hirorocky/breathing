import type { Metadata } from "next";
import Link from "next/link";
import {
  PRIVACY_CONTACT,
  SERVER_SESSION_VISITS_RETENTION_YEARS,
  SERVER_WORDS_RETENTION_YEARS,
} from "@/lib/constants";

export const metadata: Metadata = {
  title: "データの取扱いについて",
};

/** ? からのリンク先。各段落は見出しなしでも意味が通るよう書く */
export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <div className="privacy-card">
        <h1 className="privacy-title">データの取扱いについて</h1>
        <p className="privacy-lead">
          このページでは、場を使うときにどんな情報がどこに残るか、誰が見られるかを説明します。
        </p>

        <section>
          <h2>あなたの画面に見えるもの</h2>
          <p>あなたの画面には、あなたが入力した言葉が見えます。</p>
          <p>
            あなたの画面には、サービスを今使っている人数が見えます。
          </p>
        </section>

        <section>
          <h2>他の人の画面に見えるもの</h2>
          <p>
            他の人の画面には、他の人が入力した言葉が見えます。あなたの言葉は、他の人の画面には見えません。
          </p>
        </section>

        <section>
          <h2>サーバーに保存されるもの</h2>
          <p>あなたが入力した言葉は、サーバーに保存されます。</p>
          <p>
            サーバーに保存された言葉は、送信から{" "}
            {SERVER_WORDS_RETENTION_YEARS}年が経ったものから削除されます。
          </p>
          <p>
            匿名の識別子ごとに、いつ頃場にいたか・およそ何秒いたかが、個人を特定できない形で記録されることがあります。記録は訪問の終了から{" "}
            {SERVER_SESSION_VISITS_RETENTION_YEARS}年が経ったものから削除されます。
          </p>
        </section>

        <section>
          <h2>サービス運営者が見られるもの</h2>
          <p>サービス運営者は、このサイトを運営する者を指します。</p>
          <p>
            サービス運営者は、サーバーに保存された言葉の文面を見ることがあります。いつ頃使われたかや、おおよその人数などの利用状況も、個人を特定できない形で見ることがあります。
          </p>
          <p>
            サービス運営者がそれらを見る目的は、返信や評価ではなく、場の様子を把握して設計を見直すことです。第三者への提供や広告目的では使いません。
          </p>
          <p>
            このサイトの利用にあたり、アカウント登録や名前・メールアドレスの入力は必要ありません。
          </p>
        </section>

        <section>
          <h2>お問い合わせ</h2>
          <p>
            データの取扱いについての質問は、サービス運営者までメールでご連絡ください。
          </p>
          <p>
            {PRIVACY_CONTACT ? (
              <>
                サービス運営者のメールアドレスは{" "}
                <a href={`mailto:${PRIVACY_CONTACT}`} className="privacy-contact">
                  {PRIVACY_CONTACT}
                </a>{" "}
                です。
              </>
            ) : (
              <>
                サービス運営者のメールアドレスは、公開時に本ページへ記載します。
              </>
            )}
          </p>
        </section>

        <p className="privacy-back">
          <Link href="/" className="help-privacy-link">
            場に戻る
          </Link>
        </p>
      </div>
    </main>
  );
}
