(function (global) {
  const EcoGame = (global.EcoGame = global.EcoGame || {});

  EcoGame.ECOSYSTEMS = {
    donana: {
      id: "donana",
      name: "Parque Nacional de Doñana",
      subtitle: "Marismas, dunas y cotos con lince ibérico y conejo de monte",
    },
    sierra_morena: {
      id: "sierra_morena",
      name: "Sierra Morena",
      subtitle: "Bosque mediterráneo andaluz con encinas, monte bajo y fauna ibérica",
    },
  };

  EcoGame.SPECIES = {
    nutrients: {
      key: "nutrients",
      label: "Nutrientes",
      colorName: "Marrón",
      emoji: "🪱",
      zone: "nutrients",
      desc: "Materia mineral y orgánica del suelo que permite nacer nuevas plantas.",
    },
    plants: {
      key: "plants",
      label: "Plantas",
      colorName: "Verde",
      emoji: "🌱",
      zone: "plants",
      desc: "Productores: fabrican su alimento con luz solar, agua y nutrientes.",
    },
    rabbits: {
      key: "rabbits",
      label: "Conejos",
      colorName: "Blanca",
      emoji: "🐇",
      zone: "rabbits",
      desc: "Consumidores primarios (herbívoros): se alimentan de plantas.",
    },
    lynx: {
      key: "lynx",
      label: "Lince ibérico",
      colorName: "Naranja",
      emoji: "🐆",
      zone: "lynx",
      desc: "Consumidor secundario (depredador): controla la población de conejos.",
    },
    insects: {
      key: "insects",
      label: "Insectos",
      colorName: "Amarilla",
      emoji: "🐞",
      emojis: ["🐞", "🐜", "🐝", "🪲", "🐌"],
      zone: "center",
      desc: "Polinizadores y descomponedores: reciclan restos en nutrientes y ayudan a las plantas.",
    },
    remains: {
      key: "remains",
      label: "Restos orgánicos",
      colorName: "Gris",
      emoji: "🦴",
      zone: "center",
      desc: "Restos de animales cazados que los descomponedores transforman en nutrientes.",
    },
  };

  EcoGame.ROLES = [
    {
      id: "nutrients",
      name: "Nutrientes (Suelo)",
      emoji: "🪱",
      desc: "Mueve las fichas marrones: recoge nutrientes reciclados y envíalos a las plantas.",
    },
    {
      id: "plants",
      name: "Plantas (Productores)",
      emoji: "🌱",
      desc: "Mueve las fichas verdes: hace brotar nuevas plantas con los nutrientes recibidos.",
    },
    {
      id: "rabbits",
      name: "Conejos (Herbívoros)",
      emoji: "🐇",
      desc: "Mueve las fichas blancas: solo puede alimentarse de plantas.",
    },
    {
      id: "lynx",
      name: "Lince ibérico (Depredador)",
      emoji: "🐆",
      desc: "Mueve las fichas naranjas: solo puede cazar conejos.",
    },
    {
      id: "insects",
      name: "Insectos (Descomponedores)",
      emoji: "🐞",
      desc: "Mueve las fichas amarillas: sobrevive con plantas y solo recicla restos orgánicos.",
    },
    {
      id: "remains",
      name: "Restos orgánicos",
      emoji: "🦴",
      desc: "Mueve las fichas grises al centro tras la caza para que los insectos las reciclen.",
    },
  ];

  // Cartas del Anexo 3 + página 3 del documento
  EcoGame.CARDS = [
    {
      id: "drought",
      title: "Sequía extrema",
      emoji: "🏜️",
      effectText: "Se seca la mitad de las plantas.",
      explain: "Sin agua suficiente, la vegetación disminuye drásticamente y afecta a herbívoros e insectos.",
    },
    {
      id: "poaching",
      title: "Caza furtiva",
      emoji: "🔫",
      effectText: "Mueren todos los linces del bosque.",
      explain: "Al desaparecer el depredador, parece que los conejos vivirán mejor... pero ¿qué pasará con las plantas?",
    },
    {
      id: "disease",
      title: "Enfermedad",
      emoji: "🦠",
      effectText: "Mueren la mitad de los conejos.",
      explain: "Una epidemia reduce a los consumidores primarios y deja con menos presas al lince.",
    },
    {
      id: "insecticide",
      title: "Uso masivo de insecticidas",
      emoji: "🧴",
      effectText: "Mueren todos los insectos. Durante dos rondas no hay.",
      explain: "Sin insectos, los restos se acumulan sin reciclarse, el suelo pierde nutrientes y dejan de nacer plantas.",
    },
    {
      id: "trash",
      title: "Basura",
      emoji: "🗑️",
      effectText: "Desaparecen todos los nutrientes y uno de cada especie.",
      explain: "Los residuos degradan el suelo fértil y dañan a todos los eslabones de la cadena trófica.",
    },
    {
      id: "pollution",
      title: "Contaminación",
      emoji: "🏭",
      effectText: "Mueren todos los insectos y las plantas.",
      explain: "La contaminación destruye a la vez a los productores y a los descomponedores/polinizadores.",
    },
  ];

  EcoGame.PHASES = [
    { id: "card", label: "Carta", short: "🃏 Carta" },
    { id: "predict", label: "Predicción", short: "🔮 Inicio" },
    { id: "turn_rabbits", label: "Turno Conejos", short: "🐇 Conejos" },
    { id: "turn_lynx", label: "Turno Lince", short: "🐆 Lince" },
    { id: "turn_remains", label: "Turno Restos", short: "🦴 Restos" },
    { id: "turn_insects", label: "Turno Insectos", short: "🐞 Insectos" },
    { id: "turn_nutrients", label: "Turno Nutrientes", short: "🪱 Nutrientes" },
    { id: "turn_plants", label: "Turno Plantas", short: "🌱 Plantas" },
    { id: "round_end", label: "Registro", short: "📋 Registro" },
  ];

  // Comprobación del aprendizaje (Página 4 del documento)
  EcoGame.QUIZ_CASES = [
    {
      id: "bees",
      badge: "Noticia real · Caso 1",
      title: "Desaparecen las abejas e insectos de una comarca andaluza",
      prompt: "Según lo observado en el juego, ¿qué ocurrirá primero con las plantas y después con los herbívoros?",
      options: [
        {
          text: "Las plantas crecerán más porque nadie las molesta y habrá más conejos.",
          correct: false,
        },
        {
          text: "No se reciclan restos ni se poliniza bien, nacen menos plantas y los herbívoros acaban quedándose sin comida.",
          correct: true,
        },
        {
          text: "No pasa nada porque los depredadores no comen insectos.",
          correct: false,
        },
      ],
      feedback:
        "¡Exacto! Es el efecto dominó del ecosistema: sin insectos (descomponedores y polinizadores), el suelo pierde nutrientes, nacen menos plantas y los herbívoros y depredadores también sufren.",
    },
    {
      id: "wolves",
      badge: "Noticia real · Caso 2",
      title: "Desaparecen los lobos o linces de un parque natural",
      prompt: "Mucha gente piensa: 'sin depredadores los conejos vivirán felices para siempre'. ¿Qué demuestra el pensamiento sistémico?",
      options: [
        {
          text: "Los conejos se multiplican sin control, agotan todas las plantas y luego también mueren de hambre.",
          correct: true,
        },
        {
          text: "Los conejos aprenden a comer tierra para sobrevivir sin plantas.",
          correct: false,
        },
        {
          text: "Las plantas aumentan porque ya no hay depredadores.",
          correct: false,
        },
      ],
      feedback:
        "¡Muy bien! Los depredadores no son 'malos': regulan la población de herbívoros y mantienen el equilibrio dinámico de todo el bosque mediterráneo.",
    },
  ];

  EcoGame.RULES_HTML = `
    <div class="rules-doc">
      <p><strong>Propuesta didáctica:</strong> Segundo ciclo de Educación Primaria (3º y 4º). Saberes básicos: <code>CMN.2.A.1.1</code>, <code>CMN.2.A.2.4</code> y <code>CMN.2.A.2.6</code>.</p>
      <h4>1. Tablero y fichas iniciales</h4>
      <ul>
        <li>🪱 <strong>4 Nutrientes</strong> (fichas marrones) en la zona suelo.</li>
        <li>🌱 <strong>10 Plantas</strong> (fichas verdes) en la zona productores.</li>
        <li>🐇 <strong>5 Conejos</strong> (fichas blancas) en la zona consumidores primarios.</li>
        <li>🐆 <strong>1 Lince ibérico</strong> (ficha naranja) en la zona consumidores secundarios.</li>
        <li>🐞 <strong>3 Insectos</strong> (fichas amarillas) en el círculo central.</li>
        <li>📦 <strong>Reserva de la Naturaleza:</strong> 5 plantas, 6 nutrientes, 2 conejos, 2 insectos, 1 lince y fichas grises de restos orgánicos.</li>
      </ul>
      <h4>2. Orden de cada ronda</h4>
      <ol>
        <li><strong>Alimentación:</strong>
          <ul>
            <li>1 conejo come <strong>2 plantas</strong> (van a la caja). Si no hay comida, muere.</li>
            <li>1 lince come <strong>2 conejos</strong>. Los conejos cazados pasan al centro como <strong>fichas grises (restos orgánicos)</strong>.</li>
            <li>1 insecto necesita al menos <strong>3 plantas</strong> para vivir (no las elimina, solo necesita que estén ahí al inicio de la fase).</li>
          </ul>
        </li>
        <li><strong>Reciclaje y descomposición:</strong>
          <ul>
            <li>1 insecto come <strong>1 resto orgánico</strong> y lo transforma en <strong>2 nutrientes</strong> (fichas marrones).</li>
          </ul>
        </li>
        <li><strong>Crecimiento:</strong>
          <ul>
            <li>Por cada insecto vivo se puede intercambiar <strong>1 nutriente</strong> por <strong>1 planta</strong>.</li>
            <li>Por cada <strong>2 conejos</strong> bien alimentados nace <strong>+1 conejo</strong>.</li>
            <li>Por cada <strong>2 linces y 4 conejos</strong> bien alimentados nace <strong>+1 lince</strong>.</li>
            <li>Por cada <strong>8 plantas y 1 insecto</strong> nace <strong>+1 insecto</strong> (máximo 5 en el tablero).</li>
          </ul>
        </li>
      </ol>
      <h4>3. Carta del Ecosistema (Ronda 3)</h4>
      <p>Al inicio de la tercera ronda se roba una carta especial (Sequía extrema, Caza furtiva, Enfermedad, Insecticida, Basura o Contaminación) para observar el <strong>efecto dominó</strong> en el ecosistema.</p>
    </div>
  `;
})(window);
