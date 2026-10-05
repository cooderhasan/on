import Decimal from "decimal.js";
import { checkTaxId } from "./tax-id";
import { num, partyXml, tag, xmlEscape, type UblParty } from "./ubl";

/**
 * UBL-TR 1.2.1 e-İrsaliye (DespatchAdvice, TEMELIRSALIYE / SEVK) — saf fonksiyon.
 * Kaynak: NES "UBL-TR İrsaliye" XML örnekleri (developertest.nes.com.tr/docs/ubl-xml/despatch-advice).
 *  - Taşıma: şoför (ad soyad + TCKN) ve araç plakası ve/veya taşıyıcı firma (VKN / TCKN, unvan, il / ilçe).
 *  - Fiili sevk tarihi / saati zorunlu; satırda OrderLineReference/LineID zorunlu.
 *  - Numara: 3 harfli seri verilir, NES numarayı atar. İmza NES tarafından eklenir. Tüm metinler kaçışlıdır.
 */

export interface UblDespatchLine { name: string; code?: string | null; quantity: Decimal.Value; unitCode: string }

export interface UblDespatch {
  uuid: string;
  /** 3 harfli seri (NES numara verir) veya 16 haneli tam numara */
  id: string;
  issueDate: string;
  issueTime: string;
  notes: string[];
  supplier: UblParty;
  /** Sevk eden kişi (DespatchContact) */
  despatchContact: string;
  customer: UblParty;
  /** Teslimat adresi (alıcı adresinden farklıysa, serbest metin) */
  deliveryAddress?: string | null;
  despatchDate: string;
  /** HH:MM veya HH:MM:SS */
  despatchTime: string;
  driver?: { name: string; tckn: string } | null;
  vehiclePlate?: string | null;
  trailerPlate?: string | null;
  carrier?: { taxNumber: string; title: string; district?: string | null; city?: string | null } | null;
  lines: UblDespatchLine[];
}

/** Plaka: boşluksuz büyük harf (34 ABC 123 → 34ABC123) */
export const normalizePlate = (p: string) => p.toLocaleUpperCase("tr").replace(/[\s-]/g, "");
const PLATE = /^(0[1-9]|[1-7]\d|8[01])[A-Z]{1,3}\d{2,5}$/;

/** Ad soyad → ad / soyad (son kelime soyad) */
function splitName(full: string): { first: string; family: string } {
  const w = full.trim().split(/\s+/);
  return w.length > 1 ? { family: w.pop()!, first: w.join(" ") } : { first: full.trim(), family: "" };
}

/** Gönderim öncesi kontroller — Türkçe mesajlar (boşsa gönderilebilir) */
export function validateDespatch(d: UblDespatch): string[] {
  const errs: string[] = [];
  const party = (p: UblParty, who: string) => {
    if (!/^\d{10,11}$/.test(p.taxNumber)) errs.push(`${who} VKN / TCKN eksik veya hatalı.`);
    if (!p.title.trim()) errs.push(`${who} unvanı / adı eksik.`);
    if (!p.city?.trim()) errs.push(`${who} il bilgisi eksik.`);
    if (!p.district?.trim()) errs.push(`${who} ilçe bilgisi eksik.`);
  };
  party(d.supplier, "Firma (gönderen)");
  party(d.customer, "Alıcı");
  if (!/^[A-Z0-9]{3}$/.test(d.id) && !/^[A-Z0-9]{3}\d{13}$/.test(d.id)) errs.push("e-İrsaliye serisi 3 karakter olmalı (e-Fatura Ayarları › e-İrsaliye serisi).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.despatchDate)) errs.push("Fiili sevk tarihi eksik.");
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(d.despatchTime)) errs.push("Fiili sevk saati eksik (ör. 09:30).");
  if (d.despatchDate < d.issueDate) errs.push("Sevk tarihi düzenleme tarihinden önce olamaz.");

  const hasDriver = Boolean(d.driver?.name.trim() || d.driver?.tckn.trim());
  const hasCarrier = Boolean(d.carrier?.taxNumber.trim() || d.carrier?.title.trim());
  if (!hasDriver && !hasCarrier) errs.push("Taşıma bilgisi gerekli: şoför (ad soyad, TCKN) ve araç plakası ya da taşıyıcı firma.");
  if (hasDriver) {
    if (splitName(d.driver!.name).family === "") errs.push("Şoförün adı ve soyadı birlikte yazılmalı.");
    const t = checkTaxId(d.driver!.tckn.trim());
    if (d.driver!.tckn.trim().length !== 11 || !t.ok) errs.push("Şoför TCKN geçersiz.");
    if (!d.vehiclePlate || !PLATE.test(normalizePlate(d.vehiclePlate))) errs.push("Araç plakası geçersiz (ör. 42 ABC 123).");
  }
  if (d.trailerPlate && !PLATE.test(normalizePlate(d.trailerPlate))) errs.push("Dorse plakası geçersiz.");
  if (hasCarrier) {
    const t = checkTaxId(d.carrier!.taxNumber.trim());
    if (!t.ok) errs.push("Taşıyıcı firma VKN / TCKN geçersiz.");
    if (!d.carrier!.title.trim()) errs.push("Taşıyıcı firma unvanı eksik.");
    if (!d.carrier!.city?.trim() || !d.carrier!.district?.trim()) errs.push("Taşıyıcı firmanın il ve ilçesi gerekli.");
  }
  if (!d.lines.length) errs.push("İrsaliyede satır yok.");
  d.lines.forEach((l, i) => {
    if (!new Decimal(l.quantity).greaterThan(0)) errs.push(`${i + 1}. satır: miktar sıfırdan büyük olmalı.`);
  });
  return errs;
}

export function buildDespatchXml(d: UblDespatch): string {
  const time = d.despatchTime.length === 5 ? `${d.despatchTime}:00` : d.despatchTime;
  const driver = d.driver?.name.trim() ? splitName(d.driver.name) : null;
  const plate = d.vehiclePlate ? normalizePlate(d.vehiclePlate) : null;
  const trailer = d.trailerPlate ? normalizePlate(d.trailerPlate) : null;
  const carrier = d.carrier?.taxNumber.trim() ? d.carrier : null;
  const c = d.customer;

  const shipment = [
    "<cac:Shipment>",
    "<cbc:ID>1</cbc:ID>",
    driver || plate
      ? [
          "<cac:ShipmentStage>",
          plate ? `<cac:TransportMeans><cac:RoadTransport><cbc:LicensePlateID schemeID="PLAKA">${xmlEscape(plate)}</cbc:LicensePlateID></cac:RoadTransport></cac:TransportMeans>` : "",
          driver ? `<cac:DriverPerson>${tag("cbc:FirstName", driver.first)}${tag("cbc:FamilyName", driver.family)}<cbc:Title>Şoför</cbc:Title>${tag("cbc:NationalityID", d.driver!.tckn.trim())}</cac:DriverPerson>` : "",
          "</cac:ShipmentStage>",
        ].join("")
      : "",
    "<cac:Delivery>",
    d.deliveryAddress?.trim()
      ? `<cac:DeliveryAddress>${tag("cbc:StreetName", d.deliveryAddress.trim().slice(0, 500))}${tag("cbc:CitySubdivisionName", c.district)}${tag("cbc:CityName", c.city)}<cac:Country>${tag("cbc:Name", c.country || "Türkiye")}</cac:Country></cac:DeliveryAddress>`
      : "",
    carrier
      ? [
          "<cac:CarrierParty>",
          `<cac:PartyIdentification><cbc:ID schemeID="${carrier.taxNumber.trim().length === 11 ? "TCKN" : "VKN"}">${xmlEscape(carrier.taxNumber.trim())}</cbc:ID></cac:PartyIdentification>`,
          `<cac:PartyName>${tag("cbc:Name", carrier.title)}</cac:PartyName>`,
          `<cac:PostalAddress>${tag("cbc:CitySubdivisionName", carrier.district)}${tag("cbc:CityName", carrier.city)}<cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country></cac:PostalAddress>`,
          "</cac:CarrierParty>",
        ].join("")
      : "",
    `<cac:Despatch>${tag("cbc:ActualDespatchDate", d.despatchDate)}${tag("cbc:ActualDespatchTime", time)}</cac:Despatch>`,
    "</cac:Delivery>",
    trailer ? `<cac:TransportHandlingUnit><cac:TransportEquipment><cbc:ID schemeID="DORSEPLAKA">${xmlEscape(trailer)}</cbc:ID></cac:TransportEquipment></cac:TransportHandlingUnit>` : "",
    "</cac:Shipment>",
  ].join("");

  const lines = d.lines.map((l, i) =>
    [
      "<cac:DespatchLine>",
      `<cbc:ID>${i + 1}</cbc:ID>`,
      `<cbc:DeliveredQuantity unitCode="${xmlEscape(l.unitCode)}">${num(l.quantity, 4)}</cbc:DeliveredQuantity>`,
      `<cac:OrderLineReference><cbc:LineID>${i + 1}</cbc:LineID></cac:OrderLineReference>`,
      `<cac:Item>${tag("cbc:Name", l.name)}${l.code ? `<cac:SellersItemIdentification>${tag("cbc:ID", l.code)}</cac:SellersItemIdentification>` : ""}</cac:Item>`,
      "</cac:DespatchLine>",
    ].join(""),
  );

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">`,
    "<cbc:UBLVersionID>2.1</cbc:UBLVersionID>",
    "<cbc:CustomizationID>TR1.2.1</cbc:CustomizationID>",
    "<cbc:ProfileID>TEMELIRSALIYE</cbc:ProfileID>",
    tag("cbc:ID", d.id),
    "<cbc:CopyIndicator>false</cbc:CopyIndicator>",
    tag("cbc:UUID", d.uuid),
    tag("cbc:IssueDate", d.issueDate),
    tag("cbc:IssueTime", d.issueTime),
    "<cbc:DespatchAdviceTypeCode>SEVK</cbc:DespatchAdviceTypeCode>",
    ...d.notes.filter(Boolean).map((n) => tag("cbc:Note", n.slice(0, 1000))),
    `<cbc:LineCountNumeric>${d.lines.length}</cbc:LineCountNumeric>`,
    `<cac:DespatchSupplierParty>${partyXml(d.supplier)}<cac:DespatchContact>${tag("cbc:Name", d.despatchContact)}</cac:DespatchContact></cac:DespatchSupplierParty>`,
    `<cac:DeliveryCustomerParty>${partyXml(d.customer)}</cac:DeliveryCustomerParty>`,
    shipment,
    ...lines,
    "</DespatchAdvice>",
  ].join("\n");
}
