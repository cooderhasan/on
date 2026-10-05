import type { Metadata } from "next";
import { UserDetailPage } from "@/components/user-views";

export const metadata: Metadata = { title: "Kullanıcı" };

export default function Page(props: PageProps<"/kullanicilar/[id]">) {
  return <UserDetailPage params={props.params} />;
}
