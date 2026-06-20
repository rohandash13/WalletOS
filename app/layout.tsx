import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WalletOS | Private Banker for the 99%",
  description:
    "A demo financial copilot that turns plain-English money goals into visible, safe actions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
