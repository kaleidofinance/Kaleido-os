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
      <main className="mx-auto w-full max-w-[900px] px-5 pb-16 pt-2">
        {children}
      </main>
    </>
  );
}
