{{/* Shared helpers. UNTESTED. */}}

{{- define "freetv.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "freetv.selector" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* usage: include "freetv.component" (dict "root" . "name" "api") -> <release>-api */}}
{{- define "freetv.component" -}}
{{- printf "%s-%s" .root.Release.Name .name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* usage: include "freetv.image" (dict "root" . "name" "api") */}}
{{- define "freetv.image" -}}
{{- printf "ghcr.io/%s/freetv-%s:%s" .root.Values.image.owner .name .root.Values.image.tag -}}
{{- end -}}

{{- define "freetv.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" .Release.Name -}}
{{- end -}}
{{- end -}}

{{- define "freetv.publicUrl" -}}
{{- if .Values.publicUrl -}}
{{- .Values.publicUrl -}}
{{- else if .Values.ingress.tls -}}
{{- printf "https://%s" .Values.domain -}}
{{- else -}}
{{- printf "http://%s" .Values.domain -}}
{{- end -}}
{{- end -}}
