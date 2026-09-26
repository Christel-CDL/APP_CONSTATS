FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html \
     app.js \
     drafts.js \
     dossiers.js \
     drawing.js \
     export-actions.js \
     field-app.js \
     offline.js \
     pdf-report.js \
     refinements.css \
     styles.css \
     sw.js \
     visit-access.js \
     word-report.js \
     /usr/share/nginx/html/
COPY vendor/ /usr/share/nginx/html/vendor/
