#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=''
export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
export AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED
account=${ROLE_STUDIO_R2_ACCOUNT_ID:-}
bucket=${ROLE_STUDIO_R2_BUCKET:-}
version=${ROLE_STUDIO_BUILD_VERSION:-}
if [[ ! "$account" =~ ^[a-f0-9]{32}$ || ! "$bucket" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ||
      ! "$version" =~ ^[1-9][0-9]{0,9}$ || "$version" -gt 2100000000 ||
      -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  echo 'Private update configuration is incomplete or invalid.' >&2
  exit 1
fi
apk="android-personal/role-studio-personal-$version.apk"
test -f "$apk"
size=$(stat -c '%s' "$apk")
if ((size < 1 || size > 67108864)); then echo 'APK size is outside the update limit.' >&2; exit 1; fi
hash=$(sha256sum "$apk"); hash=${hash%% *}
manifest=$(mktemp)
trap 'rm -f "$manifest"' EXIT
printf '{"schema":1,"applicationId":"com.dafanshu.rolestudio","versionCode":%s,"size":%s,"sha256":"%s"}\n' "$version" "$size" "$hash" > "$manifest"
printf -v order '%010d' "$((2100000000 - version))"
endpoint="https://$account.r2.cloudflarestorage.com"
aws --endpoint-url "$endpoint" s3api put-object --bucket "$bucket" --key "apks/$version/$hash.apk" \
  --body "$apk" --content-type application/vnd.android.package-archive --no-cli-pager >/dev/null
# Publish the manifest last so clients never receive an update before the signed APK is uploaded.
aws --endpoint-url "$endpoint" s3api put-object --bucket "$bucket" --key "manifests/$order.json" \
  --body "$manifest" --content-type application/json --no-cli-pager >/dev/null
printf 'Published private update %s.\n' "$version"
