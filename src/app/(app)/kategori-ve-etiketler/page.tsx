import type { Metadata } from "next";
import { X } from "lucide-react";
import type { CategoryType } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { CATEGORY_TYPE_LABELS, listCategories, listTags } from "@/server/services/categories";
import { deleteCategoryAction, deleteTagAction } from "@/app/actions/records";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { CategoryForm, TagForm } from "@/components/category-forms";

export const metadata: Metadata = { title: "Kategori ve Etiketler" };

export default async function CategoriesPage() {
  const user = await requireUser();
  const canEdit = can(user.role, "catalog.manage");
  const [categories, tags] = await Promise.all([listCategories(), listTags()]);
  const types = Object.keys(CATEGORY_TYPE_LABELS) as CategoryType[];

  return (
    <>
      <PageHeader title="Kategori ve Etiketler" />
      <div className="grid gap-4 lg:grid-cols-2">
        {types.map((type) => {
          const list = categories.filter((c) => c.type === type);
          return (
            <Card key={type}>
              <CardHeader title={CATEGORY_TYPE_LABELS[type]} />
              <div className="flex flex-col gap-3 p-4">
                {list.length === 0 ? (
                  <p className="text-sm text-text-3">Kategori yok — kayıtlar &quot;kategorisiz&quot; görünür.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {list.map((c) => (
                      <li key={c.id} className="flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-semibold uppercase text-white" style={{ background: c.color }}>
                        {c.name}
                        {canEdit && (
                          <form action={deleteCategoryAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <button type="submit" className="opacity-70 hover:opacity-100" aria-label={`${c.name} kategorisini sil`} title="Sil (kayıtlar kategorisiz olur)"><X className="size-3" /></button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit && <CategoryForm type={type} />}
              </div>
            </Card>
          );
        })}
        <Card>
          <CardHeader title="Etiketler" />
          <div className="flex flex-col gap-3 p-4">
            <p className="text-xs text-text-3">Etiketler faturalarda kullanılır; Gelir Gider Raporu&apos;nda etiket bazında kârlılık görülür.</p>
            {tags.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <li key={t.id} className="flex items-center gap-1 rounded-sm border border-dashed border-text-3 px-2 py-1 text-[11px] font-semibold uppercase text-text-2">
                    {t.name}
                    {canEdit && (
                      <form action={deleteTagAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" className="opacity-60 hover:opacity-100" aria-label={`${t.name} etiketini sil`}><X className="size-3" /></button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && <TagForm />}
          </div>
        </Card>
      </div>
    </>
  );
}
