import type { CustomerGroup, CustomerRecord } from "../shared/types";

/** Las sugerencias iniciales no reemplazan una clasificación editada por Villa Mitre. */
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases: Array<[CustomerGroup, string[]]> = [
  ["Franquicia", ["catalina collardin", "pasta club", "salvatore", "leandro taboh", "lacroze", "el besucon", "pasta bar"]],
  ["Almacén", ["la rosa", "la italiana", "el lobulo", "don nazareno", "magdalena", "antonino almacen", "la impulsiva almacen", "leble honduras", "leble nordelta", "leble palermo", "leble ramos mejia", "leble vicente lopez", "leble ballester", "leble benavidez", "leble boyaca", "leble colegiales", "leble la paz", "leble puyrredon", "leble otamendi", "leble acassuso", "leble nunez", "leble donado", "leble saavedra", "leble arredondo", "leble 3 de febrero", "leble dorrego", "leble belgrano", "leble caballito", "leble hudson", "leble santa fe", "melania rossi"]],
  ["Restaurante", ["domenica", "alimentos kb", "leloir", "nobel", "banda restaurante", "banda", "geppetto", "gappetto", "jemma srl", "jemma", "johan", "mara", "andy", "andys bakeshop", "leble flores", "suss", "the bakery olivos", "the bakeri san isidro", "the bakery san isidro", "casa republica", "club aleman", "rustique", "la aldea", "presidente san isidro", "alvarez luis alberto", "bar stockholm", "manolo", "brava", "alba", "seis", "mano verde", "camorra", "patagonia suites", "patagonia", "n33", "dorear", "base blend", "chula cafe", "croque belgrano", "croque libertador", "el trebol", "panaderia margarita", "presidente recoleta", "the bakeri victoria", "the bakery victoria", "tilo billinghurst", "titola zapiola", "esmeralda zona norte", "estancia", "soom resto"]],
];

export function suggestedCustomerGroup(name: string): CustomerGroup {
  const value = normalize(name);
  for (const [group, names] of aliases) if (names.some((item) => normalize(item) === value)) return group;
  return "Sin grupo";
}

export function customerGroupOf(customer?: CustomerRecord): CustomerGroup {
  return customer?.customerGroup || suggestedCustomerGroup(customer?.name || "");
}
