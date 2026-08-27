import Nav from "@/components/v2/Nav";

/**
 * The .kaleido-v2 wrapper now comes from the (app) group layout, so this only
 * supplies the nav and the content column.
 */
export default function NotificationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Nav />
      {/* pb clears the fixed bottom tab bar (mobile-only) plus the notched-phone
          home-indicator inset the bar reserves; a flat pb-16 hid the last row
          under the bar. Inline style rather than a pb-[calc(...)] utility: the
          value mixes rem with env(), and an inline style is guaranteed to emit
          without depending on the JIT parsing an arbitrary value that has env()
          inside it. env() is 0 where there's no inset, so desktop is unchanged. */}
      <main
        className="mx-auto w-full max-w-[900px] px-5 pt-2"
        style={{ paddingBottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {children}
      </main>
    </>
  );
}
