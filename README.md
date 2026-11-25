# 🌿 Ecosistema Andaluz — Juego Interactivo de Red Trófica

Juego educativo interactivo basado en la propuesta didáctica **"¿Cómo podemos favorecer el aprendizaje de las ciencias?"** (2.º ciclo de Educación Primaria · 3.º y 4.º curso · Andalucía: Doñana y Sierra Morena).

## ✨ Características principales
- **100% estático para GitHub Pages:** Sin servidores ni bases de datos que configurar.
- **Salas multijugador por código:** El anfitrión crea una sala y obtiene un código de 6 caracteres (y un enlace directo `?sala=CODIGO`) para que cualquier persona se una desde otro navegador o dispositivo usando WebRTC (PeerJS).
- **Roles por zonas del tablero:** Cada participante puede encargarse de una de las 5 zonas (Suelo/Nutrientes, Plantas, Conejos, Lince Ibérico, Insectos y Restos).
- **Modo en un solo dispositivo:** Para jugar individualmente o proyectado en el aula.
- **Fiel al documento original:**
  - Tablero de 5 zonas (4 cuadrantes + círculo central).
  - Fichas iniciales y **Caja "Reserva de la Naturaleza"**.
  - Fases por ronda: Predicción → Alimentación → Reciclaje y Descomposición → Crecimiento → Registro.
  - **Carta del Ecosistema en Ronda 3** (Sequía extrema, Caza furtiva, Enfermedad, Insecticida, Basura, Contaminación).
  - **Tabla de registro + gráfica de evolución** en tiempo real para observar el efecto dominó.
  - **Puesta en común y Comprobación del aprendizaje** (análisis de noticias reales sobre abejas y depredadores).

## 🚀 Cómo publicarlo gratis en GitHub Pages
1. Crea un repositorio nuevo en GitHub (por ejemplo, `ecosistema-andaluz-juego`).
2. Sube todos los archivos de esta carpeta (`index.html`, `styles.css`, `js/`, `.nojekyll`, `README.md`) a la rama `main`.
3. En GitHub, entra en **Settings → Pages**.
4. En **Build and deployment → Source**, elige **Deploy from a branch**, selecciona la rama **`main`** y la carpeta **`/ (root)`**, y pulsa **Save**.
5. En ~1 minuto tendrás tu enlace público `https://TU_USUARIO.github.io/ecosistema-andaluz-juego/` listo para que cualquiera cree salas y juegue con códigos.
