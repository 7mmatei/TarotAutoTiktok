export interface CardMeaning {
  general: string;
  relationship?: string;
  career?: string;
  warning?: string;
  constructive?: string;
}

export interface Card {
  id: string;
  names: { "es-MX": string; "pt-BR": string };
  upright: CardMeaning;
  reversed: CardMeaning;
}

const majorArcana: Card[] = [
  ["the-fool", "El Loco", "O Louco", "nuevos comienzos, espontaneidad y un salto de fe", "imprudencia, distracción o miedo a comenzar"],
  ["the-magician", "El Mago", "O Mago", "iniciativa, recursos y capacidad de convertir una idea en acción", "talento disperso, manipulación o planes sin ejecutar"],
  ["the-high-priestess", "La Sacerdotisa", "A Sacerdotisa", "intuición, silencio y conocimiento que aún se está revelando", "desconexión de la intuición, secretos o señales ignoradas"],
  ["the-empress", "La Emperatriz", "A Imperatriz", "creatividad, cuidado, abundancia y crecimiento", "agotamiento por cuidar de más, bloqueo creativo o descuido propio"],
  ["the-emperor", "El Emperador", "O Imperador", "estructura, estabilidad, liderazgo y límites claros", "rigidez, control excesivo o falta de una base estable"],
  ["the-hierophant", "El Hierofante", "O Hierofante", "tradición, aprendizaje, guía y valores compartidos", "cuestionar convenciones, consejo limitado o valores prestados"],
  ["the-lovers", "Los Enamorados", "Os Enamorados", "elección consciente, unión y coherencia con los propios valores", "desalineación, indecisión o una conexión que requiere honestidad"],
  ["the-chariot", "El Carro", "O Carro", "dirección, determinación y avance con autocontrol", "falta de rumbo, prisa o fuerzas que tiran en sentidos opuestos"],
  ["strength", "La Fuerza", "A Força", "coraje sereno, paciencia y dominio amable de los impulsos", "duda personal, energía baja o emociones difíciles de regular"],
  ["the-hermit", "El Ermitaño", "O Eremita", "introspección, búsqueda interior y perspectiva", "aislamiento, rumiación o evitar la guía disponible"],
  ["wheel-of-fortune", "La Rueda de la Fortuna", "A Roda da Fortuna", "cambio de ciclo, movimiento y oportunidad inesperada", "resistencia al cambio, repetición de patrones o tiempo incierto"],
  ["justice", "La Justicia", "A Justiça", "equilibrio, responsabilidad y evaluación honesta de los hechos", "desbalance, prejuicio o consecuencias que aún no se reconocen"],
  ["the-hanged-man", "El Colgado", "O Enforcado", "pausa voluntaria, nueva perspectiva y entrega de control", "estancamiento, sacrificio innecesario o demora sin aprendizaje"],
  ["death", "La Muerte", "A Morte", "final necesario, transformación y espacio para una etapa nueva", "resistencia a cerrar, apego o transformación pospuesta"],
  ["temperance", "La Templanza", "A Temperança", "moderación, integración, paciencia y armonía gradual", "exceso, impaciencia o elementos que todavía no se combinan"],
  ["the-devil", "El Diablo", "O Diabo", "apegos, hábitos y deseos que conviene mirar con honestidad", "liberación gradual, conciencia de un patrón o recuperación de poder"],
  ["the-tower", "La Torre", "A Torre", "ruptura de una estructura falsa y revelación repentina", "evitar un cambio necesario, tensión acumulada o reconstrucción interna"],
  ["the-star", "La Estrella", "A Estrela", "esperanza, renovación, autenticidad e inspiración", "desánimo temporal, vulnerabilidad o pérdida de propósito"],
  ["the-moon", "La Luna", "A Lua", "intuición, sensibilidad y tránsito por información ambigua", "confusión que empieza a aclararse, temor o autoengaño"],
  ["the-sun", "El Sol", "O Sol", "claridad, vitalidad, alegría y confianza compartida", "optimismo bloqueado, agotamiento o una alegría que necesita espacio"],
  ["judgement", "El Juicio", "O Julgamento", "evaluación, llamado interior y decisión con conciencia", "autocrítica, duda ante el llamado o dificultad para perdonarse"],
  ["the-world", "El Mundo", "O Mundo", "culminación, integración, logro y cierre completo", "asunto inconcluso, falta de cierre o meta casi alcanzada"],
].map(([id, es, pt, upright, reversed]) => ({
  id: id!,
  names: { "es-MX": es!, "pt-BR": pt! },
  upright: { general: upright! },
  reversed: { general: reversed! },
}));

const suits = {
  cups: {
    es: "Copas",
    pt: "Copas",
    upright: "emociones, vínculos e intuición",
    reversed: "emociones bloqueadas, expectativas afectivas o necesidad de cuidado interior",
  },
  pentacles: {
    es: "Oros",
    pt: "Ouros",
    upright: "recursos, trabajo, cuerpo y estabilidad práctica",
    reversed: "inseguridad material, prioridades prácticas desordenadas o progreso lento",
  },
  swords: {
    es: "Espadas",
    pt: "Espadas",
    upright: "ideas, comunicación, decisiones y verdad",
    reversed: "confusión mental, tensión comunicativa o una verdad evitada",
  },
  wands: {
    es: "Bastos",
    pt: "Paus",
    upright: "energía, creatividad, deseo y movimiento",
    reversed: "energía dispersa, retrasos, frustración o impulso mal dirigido",
  },
} as const;

const ranks = {
  ace: { es: "As", pt: "Ás", upright: "una semilla nueva y potencial disponible", reversed: "un comienzo retrasado o potencial sin canalizar" },
  two: { es: "Dos", pt: "Dois", upright: "equilibrio entre opciones y una decisión en formación", reversed: "indecisión, desequilibrio o prioridades divididas" },
  three: { es: "Tres", pt: "Três", upright: "expansión, colaboración y primeros resultados", reversed: "cooperación difícil, retraso o crecimiento desordenado" },
  four: { es: "Cuatro", pt: "Quatro", upright: "estabilidad, pausa y consolidación", reversed: "estancamiento, rigidez o necesidad de volver a moverse" },
  five: { es: "Cinco", pt: "Cinco", upright: "tensión, cambio y aprendizaje mediante un desafío", reversed: "recuperación, reconciliación o conflicto interior persistente" },
  six: { es: "Seis", pt: "Seis", upright: "ajuste, apoyo y avance hacia mayor armonía", reversed: "intercambio desigual, carga pasada o dificultad para avanzar" },
  seven: { es: "Siete", pt: "Sete", upright: "evaluación, estrategia y defensa de una posición", reversed: "duda, estrategia insuficiente o esfuerzo sin dirección clara" },
  eight: { es: "Ocho", pt: "Oito", upright: "movimiento, práctica y desarrollo sostenido", reversed: "bloqueo, repetición improductiva o prisa sin dominio" },
  nine: { es: "Nueve", pt: "Nove", upright: "madurez, autonomía y una etapa cercana a completarse", reversed: "cansancio, dependencia o dificultad para reconocer el progreso" },
  ten: { es: "Diez", pt: "Dez", upright: "culminación, resultado y transición a un nuevo ciclo", reversed: "carga excesiva, cierre incompleto o resistencia a soltar" },
  page: { es: "Sota", pt: "Pajem", upright: "curiosidad, mensaje y aprendizaje inicial", reversed: "inmadurez, noticias confusas o falta de seguimiento" },
  knight: { es: "Caballero", pt: "Cavaleiro", upright: "búsqueda activa, movimiento y compromiso con una dirección", reversed: "impulsividad, demora o acción sin suficiente reflexión" },
  queen: { es: "Reina", pt: "Rainha", upright: "madurez receptiva, criterio y dominio interior", reversed: "inseguridad, límites débiles o cualidades usadas de forma reactiva" },
  king: { es: "Rey", pt: "Rei", upright: "autoridad responsable, experiencia y dirección estable", reversed: "control excesivo, rigidez o responsabilidad mal asumida" },
} as const;

const minorArcana: Card[] = Object.entries(suits).flatMap(([suitId, suit]) =>
  Object.entries(ranks).map(([rankId, rank]) => ({
    id: `${rankId}-of-${suitId}`,
    names: {
      "es-MX": `${rank.es} de ${suit.es}`,
      "pt-BR": `${rank.pt} de ${suit.pt}`,
    },
    upright: { general: `${rank.upright}; en esta carta se expresa mediante ${suit.upright}` },
    reversed: { general: `${rank.reversed}; en esta carta puede señalar ${suit.reversed}` },
  })),
);

export const cards: readonly Card[] = [...majorArcana, ...minorArcana];
