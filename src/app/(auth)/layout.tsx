export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#f2f2f2] px-4 py-10">
      <div className="mb-8 grid size-16 place-items-center rounded-full bg-danger text-2xl font-bold text-white">Ö</div>
      <div className="w-full max-w-[410px] rounded-md bg-white p-6 shadow-sm">{children}</div>
    </div>
  );
}
