/**
 * GİB kod listeleri — kaynak: NES geliştirici dokümanı (developertest.nes.com.tr/docs/code-list, Ekim 2026).
 * Liste değişirse buradan güncellenir; değerleri tahminle eklemeyin.
 */

/** KDV tevkifat kodları (9015). Oran yüzde: 2/10 → 20. 650 "Diğer"de oran kullanıcı tarafından girilir. */
export const WITHHOLDING_CODES: Array<{ code: string; rate: number | null; label: string }> = [
  { code: "601", rate: 20, label: "Yapım işleri ile bu işlerle birlikte ifa edilen mühendislik" },
  { code: "602", rate: 90, label: "Etüt, plan-proje, danışmanlık, denetim vb." },
  { code: "603", rate: 50, label: "Makine, teçhizat, demirbaş ve taşıtlara ait tadil, bakım, onarım" },
  { code: "604", rate: 50, label: "Yemek servis hizmeti" },
  { code: "605", rate: 50, label: "Organizasyon hizmeti" },
  { code: "606", rate: 90, label: "İşgücü temin hizmetleri" },
  { code: "607", rate: 90, label: "Özel güvenlik hizmeti" },
  { code: "608", rate: 90, label: "Yapı denetim hizmetleri" },
  { code: "609", rate: 50, label: "Fason tekstil, konfeksiyon, çanta ve ayakkabı dikim işleri" },
  { code: "610", rate: 90, label: "Turistik mağazalara verilen müşteri bulma / götürme hizmetleri" },
  { code: "611", rate: 90, label: "Spor kulüplerinin yayın, reklam ve isim hakkı gelirleri" },
  { code: "612", rate: 70, label: "Temizlik hizmeti" },
  { code: "613", rate: 70, label: "Çevre ve bahçe bakım hizmetleri" },
  { code: "614", rate: 50, label: "Servis taşımacılığı" },
  { code: "615", rate: 50, label: "Her türlü baskı ve basım hizmetleri" },
  { code: "616", rate: 50, label: "5018 sayılı kanun cetvellerindeki idarelere yapılan diğer hizmetler" },
  { code: "617", rate: 50, label: "Hurda metalden elde edilen külçe teslimleri" },
  { code: "618", rate: 50, label: "Hurda dışı bakır, çinko ve alüminyum külçe teslimleri" },
  { code: "619", rate: 50, label: "Bakır, çinko ve alüminyum ürünlerinin teslimi" },
  { code: "620", rate: 50, label: "İstisnadan vazgeçenlerin hurda ve atık teslimi" },
  { code: "621", rate: 90, label: "Hurda ve atıklardan elde edilen hammadde teslimi" },
  { code: "622", rate: 90, label: "Pamuk, tiftik, yün, yapağı, ham post ve deri teslimleri" },
  { code: "623", rate: 50, label: "Ağaç ve orman ürünleri teslimi" },
  { code: "650", rate: null, label: "Diğer (oran girilir)" },
];
export const withholdingByCode = (code: string | null | undefined) => WITHHOLDING_CODES.find((w) => w.code === code) ?? null;

/** KDV istisna / muafiyet sebep kodları (KDV %0 satırlarda zorunlu). 351: istisna olmayan diğer (%0 KDV). */
export const VAT_EXEMPTION_CODES: Array<{ code: string; label: string }> = [
  { code: "351", label: "KDV istisna olmayan diğer" },
  { code: "301", label: "11/1-a Mal ihracatı" },
  { code: "302", label: "11/1-a Hizmet ihracatı" },
  { code: "303", label: "11/1-a Roaming hizmetleri" },
  { code: "304", label: "13/a Deniz, hava, demiryolu taşıma araçlarının inşa, tadil, bakım, onarımı" },
  { code: "305", label: "13/b Deniz, hava taşıma araçları için liman, hava meydanı hizmetleri" },
  { code: "306", label: "13/c Petrol aramaları ve boru hatlarına ilişkin teslim ve hizmetler" },
  { code: "307", label: "13/c Maden arama, altın, gümüş, platin işletme ve rafinaj" },
  { code: "308", label: "13/d Teşvikli yatırım malı teslimi" },
  { code: "309", label: "13/e Liman ve hava meydanı demiryolu bağlantıları, inşa ve genişletme" },
  { code: "310", label: "13/f Ulusal güvenlik amaçlı teslim ve hizmetler" },
  { code: "311", label: "14/1 Uluslararası taşımacılık" },
  { code: "312", label: "15/a Diplomatik organ ve misyonlara teslim ve hizmetler" },
  { code: "313", label: "15/b Uluslararası kuruluşlara teslim ve hizmetler" },
  { code: "314", label: "19/2 Uluslararası anlaşmalar kapsamındaki istisnalar (iade hakkı tanınan)" },
  { code: "315", label: "14/3 İhraç eşyası taşıyan araçlara motorin teslimleri" },
  { code: "316", label: "11/1-a Serbest bölge müşterisine fason hizmet" },
  { code: "317", label: "17/4-s Engellilerin eğitim, meslek ve günlük yaşam araç-gereçleri" },
  { code: "318", label: "Geçici 29 Yap-İşlet-Devret ve kiralama karşılığı sağlık / eğitim tesisleri" },
  { code: "319", label: "13/g Başbakanlık merkez teşkilatına araç teslimleri" },
  { code: "320", label: "Geçici 16 İSMEP kapsamındaki teslim ve hizmetler" },
  { code: "321", label: "Geçici 26 BM, NATO, OECD resmi kullanımına teslim ve hizmetler" },
  { code: "322", label: "11/1-a Türkiye'de ikamet etmeyenlere özel fatura ile teslimler (bavul ticareti)" },
  { code: "323", label: "13/ğ Ürün senetlerinin borsalar aracılığıyla ilk teslimi" },
  { code: "324", label: "13/h Türkiye Kızılay Derneği teslim ve hizmetleri" },
  { code: "325", label: "13/ı Yem teslimleri" },
  { code: "326", label: "13/ı Tescilli gübre teslimi" },
  { code: "327", label: "13/ı Gübre hammaddelerinin gübre üreticilerine teslimi" },
  { code: "350", label: "İstisna diğer" },
  { code: "201", label: "17/1 Kültür ve eğitim amaçlı işlemler" },
  { code: "202", label: "17/2-a Sağlık, çevre ve sosyal yardım amaçlı işlemler" },
  { code: "204", label: "17/2-c Yabancı diplomatik organ ve hayır kurumlarının bağış alımları" },
  { code: "205", label: "17/2-d Taşınmaz kültür varlıkları teslimleri ve mimarlık hizmetleri" },
  { code: "206", label: "17/2-e Mesleki kuruluşların işlemleri" },
  { code: "207", label: "17/3 Askeri fabrika" },
  { code: "208", label: "17/4-c Birleşme, devir, dönüşüm ve bölünme işlemleri" },
  { code: "209", label: "17/4-e BSMV kapsamındaki işlemler" },
  { code: "211", label: "17/4-h Zirai amaçlı / köy tüzel kişiliği içme suyu teslimleri" },
  { code: "212", label: "17/4-ı Serbest bölgelerde verilen hizmetler" },
  { code: "213", label: "17/4-j Boru hattı ile petrol ve gaz taşımacılığı" },
  { code: "214", label: "17/4-k Sanayi bölgelerinde arsa / işyeri, kooperatif konut teslimleri" },
  { code: "215", label: "17/4-l Varlık yönetim şirketlerinin işlemleri" },
  { code: "216", label: "17/4-m Tasarruf mevduatı sigorta fonunun işlemleri" },
  { code: "217", label: "17/4-n Basın-Yayın ve Enformasyon Genel Müdürlüğüne haber hizmetleri" },
  { code: "218", label: "17/4-o Gümrük antrepoları, geçici depolama ve vergisiz satış mağazaları hizmetleri" },
  { code: "219", label: "17/4-p Hazine ve Arsa Ofisi Genel Müdürlüğünün işlemleri" },
  { code: "220", label: "17/4-r KVK Geçici 28 ve 29. madde kapsamındaki teslimler" },
  { code: "221", label: "Geçici 15 Kooperatif, belediye ve SGK kuruluşlarına inşaat taahhüdü" },
  { code: "223", label: "Geçici 20/1 Teknoloji geliştirme bölgelerindeki işlemler" },
  { code: "225", label: "Geçici 23 Milli Eğitim Bakanlığına bilgisayar bağışları" },
  { code: "226", label: "17/2-b Özel okul ve üniversitelerin bedelsiz eğitim hizmetleri" },
  { code: "227", label: "17/2-b Kanun gereği bedelsiz teslim ve hizmetler" },
  { code: "228", label: "17/2-b 17/1'deki kuruluşlara bedelsiz teslimler" },
  { code: "229", label: "17/2-b Gıda bankacılığı dernek ve vakıflarına bağışlar" },
  { code: "230", label: "17/4-g Külçe altın, gümüş ve kıymetli taş teslimi" },
  { code: "231", label: "17/4-g Hurda ve atık teslimi" },
  { code: "232", label: "17/4-g Döviz, para, pul, değerli kağıt, hisse ve tahvil teslimleri" },
  { code: "234", label: "17/4-ş Konut finansmanı teminatı konutların teslimi" },
  { code: "235", label: "16/1-c Transit, antrepo, geçici depolama ve serbest bölge mallarının teslimi" },
  { code: "236", label: "19/2 Uluslararası anlaşmalar kapsamındaki istisnalar (iade hakkı tanınmayan)" },
  { code: "237", label: "17/4 Ürün senetlerinin borsalarda ilk teslimden sonraki teslimi" },
  { code: "238", label: "17/4-u Varlık kiralama şirketlerine devir ve kiralama" },
  { code: "239", label: "17/4 Taşınmazların finansal kiralama şirketlerine devri ve kiralanması" },
  { code: "240", label: "17/4-z Patentli buluşa ilişkin gayri maddi hakların kiralanması, devri, satışı" },
  { code: "250", label: "Kısmi istisna diğer" },
];
export const isVatExemptionCode = (c: string | null | undefined) => VAT_EXEMPTION_CODES.some((x) => x.code === c);

/** ÖTV vergi kodları (oranla hesaplanan listeler) */
export const OTV_CODES: Array<{ code: string; label: string }> = [
  { code: "0074", label: "ÖTV 4. liste — dayanıklı tüketim ve diğer mallar" },
  { code: "0071", label: "ÖTV 1. liste — petrol ve doğalgaz ürünleri" },
  { code: "9077", label: "ÖTV 2. liste — motorlu taşıt araçları" },
  { code: "0073", label: "ÖTV 3. liste — kolalı gazoz, alkollü içecek, tütün" },
  { code: "0075", label: "ÖTV 3A — alkollü içecekler" },
  { code: "0076", label: "ÖTV 3B — tütün mamulleri" },
  { code: "0077", label: "ÖTV 3C — kolalı gazozlar" },
];
export const OTV_NAMES: Record<string, string> = { "0071": "ÖTV 1.LİSTE", "0073": "ÖTV 3.LİSTE", "0074": "ÖTV 4.LİSTE", "0075": "ÖTV 3A LİSTE", "0076": "ÖTV 3B LİSTE", "0077": "ÖTV 3C LİSTE", "9077": "ÖTV 2.LİSTE" };
export const isOtvCode = (c: string | null | undefined) => OTV_CODES.some((x) => x.code === c);

/** e-Fatura mükellefine senaryolar (e-Arşiv: EARSIVFATURA otomatik) */
export const EINVOICE_PROFILES = [
  { value: "TICARIFATURA", label: "Ticari fatura (alıcı 8 gün içinde kabul / red edebilir)" },
  { value: "TEMELFATURA", label: "Temel fatura (alıcı reddedemez)" },
] as const;
