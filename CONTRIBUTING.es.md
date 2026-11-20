# Cómo aportar un árbol de la comunidad

*[English](CONTRIBUTING.md)*

Cualquiera puede proponer un árbol nuevo para WikiTrees. Si el responsable lo aprueba, se publica como
**árbol de la comunidad**: aparece en el [visor web](https://aruvaro-chulvi.github.io/WikiTrees/) y cualquiera
puede descargarlo desde **Offlined** (WikiÁrboles → *WikiÁrboles de la comunidad*).

Los 26 árboles oficiales son parte de Offlined y la comunidad no los modifica. Si encuentras un enlace mal en
alguno, usa el [formulario de enlace erróneo](https://github.com/Aruvaro-Chulvi/WikiTrees/issues/new?template=wrong-link.yml).

## Cómo funciona

1. **Haz tu árbol con un asistente de IA.** Copia el [prompt](community-kit/PROMPT.md) en tu asistente
   (Claude, por ejemplo), rellena el tema, el tamaño y tu nombre, y dale [FORMAT.md](community-kit/FORMAT.md)
   y el [ejemplo](community-kit/example/vitamins.json). Obtendrás un archivo `.json`.
   No hace falta saber programar, pero **el resultado es responsabilidad tuya**: léelo.
2. **Compruébalo.** Abre el **[comprobador web](https://aruvaro-chulvi.github.io/WikiTrees/community-kit/check.html)**,
   suelta tu archivo, pulsa *Comprobar los enlaces* y mira la vista previa. Corrige lo que te diga (tu
   asistente te puede ayudar: pégale los errores). Cada nodo necesita un título en los 10 idiomas, y un
   artículo exacto de Wikipedia en cada idioma o ese idioma en `noWiki`.
3. **Envíalo.** Abre el **[formulario «Nuevo árbol de la comunidad»](https://github.com/Aruvaro-Chulvi/WikiTrees/issues/new?template=new-tree.yml)**
   (necesitas una cuenta gratuita de GitHub), adjunta el `.json` (y una portada si la tienes) y acepta el
   [acuerdo para los árboles de la comunidad](CONTRIBUTOR-AGREEMENT.md).
4. **Comprobación automática.** Un bot vuelve a comprobar el archivo, también cada enlace contra Wikipedia, y
   te contesta en tu issue. Si hay errores, corrige el archivo y **edita el issue** con el adjunto nuevo: se
   comprueba otra vez. Cuando está bien, el bot abre un pull request con tu árbol.
5. **Revisión.** El responsable revisa el árbol a mano (tema, estructura, títulos y enlaces) y puede pedirte
   cambios o corregir cosas pequeñas. Cuando lo aprueba y lo fusiona, se publica en unos minutos.

También puedes abrir tú el pull request: añade `community/<tu-usuario-de-github>.<slug>/tree.json` (y, si
quieres, `cover.png`), con tu usuario en minúsculas y los `-` cambiados por `_`. Marca la casilla del acuerdo
en la descripción del pull request.

## Qué hace bueno a un árbol

- Un tema claro que **no esté ya en un árbol oficial**, con una jerarquía con sentido (ramas que de verdad
  contienen a sus hijos).
- Nodos con artículo en Wikipedia: WikiTrees es una forma de explorar Wikipedia.
- Títulos naturales en cada idioma, no traducciones palabra por palabra.
- Neutral y apto para todos: Offlined lo usan familias y colegios. Los árboles sobre personas vivas, política
  o religión solo se aceptan si son objetivos y neutrales; el contenido ofensivo, de odio o para adultos se
  rechaza.

## Licencia

Los árboles de la comunidad se publican con [CC BY-NC-SA 4.0](LICENSE), como los oficiales, con tu nombre como
autor. Al enviar uno concedes además a Offlined el derecho a incluirlo en la aplicación, también con fines
comerciales: lee el [acuerdo](CONTRIBUTOR-AGREEMENT.md). Las herramientas de `community-kit/` tienen la
[licencia MIT](community-kit/LICENSE).

## Retirada y problemas

Para avisar de un problema con un árbol de la comunidad publicado, usa el
[formulario de problemas](https://github.com/Aruvaro-Chulvi/WikiTrees/issues/new?template=community-report.yml).
El responsable puede retirar un árbol borrando su carpeta o poniéndolo en `community/retired.json`; Offlined
deja entonces de ofrecerlo.
