import type { ReactNode } from "react";
import "./styles.css";

export const metadata = {
  title: "CodexDock Example",
  description: "OpenAI API 대신 로컬 Codex worker로 AI 작업을 실행하는 예제",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
