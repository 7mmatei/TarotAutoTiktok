export type RendererLocale = "es-MX" | "pt-BR";

export type VisualPhase =
  | "waiting"
  | "preparing"
  | "shuffling"
  | "reading"
  | "revealing"
  | "complete";

interface PhaseMessage {
  title: string;
  subtitle: string;
}

export const phaseCopy: Record<RendererLocale, Record<VisualPhase, PhaseMessage>> = {
  "es-MX": {
    waiting: {
      title: "Escribe tu pregunta",
      subtitle: "Mora elegirá a alguien del chat",
    },
    preparing: {
      title: "Preparando la lectura de {name}",
      subtitle: "{question}",
    },
    shuffling: {
      title: "Mezclando el mazo",
      subtitle: "{question}",
    },
    reading: {
      title: "Leyendo para {name}",
      subtitle: "{question}",
    },
    revealing: {
      title: "Leyendo para {name}",
      subtitle: "Las cartas están revelando tu mensaje",
    },
    complete: {
      title: "Lectura completada",
      subtitle: "Gracias por compartir este momento",
    },
  },
  "pt-BR": {
    waiting: {
      title: "Escreva sua pergunta",
      subtitle: "Mora escolherá alguém do chat",
    },
    preparing: {
      title: "Preparando a leitura de {name}",
      subtitle: "{question}",
    },
    shuffling: {
      title: "Embaralhando o baralho",
      subtitle: "{question}",
    },
    reading: {
      title: "Lendo para {name}",
      subtitle: "{question}",
    },
    revealing: {
      title: "Lendo para {name}",
      subtitle: "As cartas estão revelando sua mensagem",
    },
    complete: {
      title: "Leitura concluída",
      subtitle: "Obrigado por compartilhar este momento",
    },
  },
};

export type PulseKind = "comment" | "like" | "follow" | "join" | "gift" | "share";

interface PulseLabel {
  glyph: string;
  action: string;
}

export const pulseCopy: Record<RendererLocale, Record<PulseKind, PulseLabel>> = {
  "es-MX": {
    comment: { glyph: "✎", action: "preguntó" },
    like: { glyph: "♡", action: "mandó luz" },
    follow: { glyph: "✦", action: "siguió el LIVE" },
    join: { glyph: "◌", action: "entró al LIVE" },
    gift: { glyph: "✧", action: "regaló" },
    share: { glyph: "↗", action: "compartió" },
  },
  "pt-BR": {
    comment: { glyph: "✎", action: "perguntou" },
    like: { glyph: "♡", action: "mandou luz" },
    follow: { glyph: "✦", action: "seguiu o LIVE" },
    join: { glyph: "◌", action: "entrou no LIVE" },
    gift: { glyph: "✧", action: "presenteou" },
    share: { glyph: "↗", action: "compartilhou" },
  },
};

export function resolveRendererLocale(value: string | null | undefined): RendererLocale {
  return value === "pt-BR" ? "pt-BR" : "es-MX";
}

export function resolvePhaseMessage(
  locale: RendererLocale,
  phase: VisualPhase,
  viewer: string,
  question: string,
): PhaseMessage {
  const message = phaseCopy[locale][phase];
  return {
    title: message.title.replace("{name}", viewer || (locale === "pt-BR" ? "você" : "ti")),
    subtitle: message.subtitle.replace("{question}", question.trim()),
  };
}
