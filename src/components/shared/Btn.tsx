
export const Btn = ({ text, css }: { text: string; css?: string }) => {
  return (
    <div
      className={`u-btn1 w-fit cursor-pointer rounded-md border border-edge bg-surface-raised px-2.5 py-1.5 text-xs text-content-secondary transition-colors hover:border-edge-strong hover:text-content ${css}`}
    >
      {text}
    </div>
  );
};
