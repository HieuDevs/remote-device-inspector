// Integration snippets, generated with the ingest URL of the environment the
// user picked, so they work as pasted.

export const flutterInterceptor = (url: string) => `import 'dart:convert';
import 'package:dio/dio.dart';

/// Sends every Dio request to Device Inspector.
class SupportInspectorInterceptor extends Interceptor {
  SupportInspectorInterceptor({this.ingestUrl = '${url}'});
  final String ingestUrl;

  final _client = Dio(BaseOptions(connectTimeout: const Duration(seconds: 2)));

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.extra['_req_time'] = DateTime.now().millisecondsSinceEpoch;
    super.onRequest(options, handler);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    _send(response.requestOptions, response.statusCode ?? 200, response.headers.map, response.data);
    super.onResponse(response, handler);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    _send(err.requestOptions, err.response?.statusCode ?? 0, err.response?.headers.map ?? {}, err.response?.data ?? err.message);
    super.onError(err, handler);
  }

  void _send(RequestOptions req, int status, Map<String, dynamic> resHeaders, dynamic resBody) {
    try {
      final now = DateTime.now().millisecondsSinceEpoch;
      final start = (req.extra['_req_time'] as int?) ?? now;
      _client.post(ingestUrl, data: {
        'url': req.uri.toString(),
        'method': req.method,
        'statusCode': status,
        'reqHeaders': req.headers,
        'reqBody': req.data is String ? req.data : jsonEncode(req.data),
        'resHeaders': resHeaders,
        'resBody': resBody is String ? resBody : jsonEncode(resBody),
        'durationMs': now - start,
        'time': start,
        'app': 'Flutter App'
      });
    } catch (_) {}
  }
}`;

export const flutterRegister = () => `dio.interceptors.add(SupportInspectorInterceptor());`;

export const androidInterceptor = (url: string) => `import okhttp3.*
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class SupportInspectorInterceptor(
    private val ingestUrl: String = "${url}"
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val start = System.currentTimeMillis()
        var res: Response? = null
        var err: Exception? = null
        try {
            res = chain.proceed(req)
            return res
        } catch (e: Exception) {
            err = e
            throw e
        } finally {
            val dur = System.currentTimeMillis() - start
            report(req, res, err, dur, start)
        }
    }

    private fun report(req: Request, res: Response?, err: Exception?, dur: Long, time: Long) {
        thread {
            try {
                val payload = JSONObject().apply {
                    put("url", req.url.toString())
                    put("method", req.method)
                    put("statusCode", res?.code ?: 0)
                    put("durationMs", dur)
                    put("time", time)
                    put("app", "Android Native")
                    res?.body?.let { put("resBody", it.peekBody(Long.MAX_VALUE).string()) }
                }
                val conn = URL(ingestUrl).openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }
                conn.responseCode
            } catch (_: Exception) {}
        }
    }
}`;

export const androidRegister = () => `val client = OkHttpClient.Builder()
    .addInterceptor(SupportInspectorInterceptor())
    .build()`;

export const iosMonitor = (url: string) => `import Foundation
import Alamofire

final class SupportInspectorEventMonitor: EventMonitor {
    let ingestUrl = URL(string: "${url}")!

    func request<Value>(_ request: DataRequest, didParseResponse response: DataResponse<Value, AFError>) {
        guard let req = response.request else { return }
        let dur = Int((response.metrics?.taskInterval.duration ?? 0) * 1000)
        let bodyStr = response.data.flatMap { String(data: $0, encoding: .utf8) } ?? ""

        let dict: [String: Any] = [
            "url": req.url?.absoluteString ?? "",
            "method": req.httpMethod ?? "GET",
            "statusCode": response.response?.statusCode ?? 0,
            "durationMs": dur,
            "time": Int(Date().timeIntervalSince1970 * 1000),
            "resBody": bodyStr,
            "app": "iOS App"
        ]
        guard let jsonData = try? JSONSerialization.data(withJSONObject: dict) else { return }
        var ingestReq = URLRequest(url: ingestUrl)
        ingestReq.httpMethod = "POST"
        ingestReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        ingestReq.httpBody = jsonData
        URLSession.shared.dataTask(with: ingestReq).resume()
    }
}`;

export const iosRegister = () => `let session = Session(eventMonitors: [SupportInspectorEventMonitor()])`;

export const rnInspector = (url: string) => `import axios from 'axios';

const INGEST_URL = '${url}';

export function attachInspector(axiosInstance) {
  axiosInstance.interceptors.request.use(cfg => {
    cfg._startTime = Date.now();
    return cfg;
  });

  axiosInstance.interceptors.response.use(
    res => { report(res.config, res.status, res.headers, res.data); return res; },
    err => { report(err.config, err.response?.status || 0, err.response?.headers || {}, err.response?.data || err.message); return Promise.reject(err); }
  );

  function report(cfg, status, headers, body) {
    if (!cfg || cfg.url?.includes('/ingest')) return;
    const dur = Date.now() - (cfg._startTime || Date.now());
    axios.post(INGEST_URL, {
      url: cfg.baseURL ? (cfg.baseURL + cfg.url) : cfg.url,
      method: (cfg.method || 'GET').toUpperCase(),
      statusCode: status,
      reqHeaders: cfg.headers,
      reqBody: typeof cfg.data === 'string' ? cfg.data : JSON.stringify(cfg.data),
      resHeaders: headers,
      resBody: typeof body === 'string' ? body : JSON.stringify(body),
      durationMs: dur,
      app: 'React Native'
    }).catch(() => {});
  }
}`;

export const rnRegister = () => `const apiClient = axios.create({ baseURL: 'https://api.yourdomain.com' });
attachInspector(apiClient);`;

export const emulatorProxy = (port: string) => `emulator -avd <ten_avd> -http-proxy http://10.0.2.2:${port}`;

export const curlIngest = (url: string) => `curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://api.example.com/v1/orders?page=1",
    "method": "GET",
    "statusCode": 200,
    "reqHeaders": {"Authorization": "Bearer sample_token", "Accept": "application/json"},
    "resHeaders": {"Content-Type": "application/json; charset=utf-8"},
    "resBody": "{\\"status\\":\\"ok\\",\\"orders\\":[{\\"id\\":1001,\\"item\\":\\"Room Deluxe\\",\\"price\\":150}]}",
    "durationMs": 78,
    "time": 1728300000000,
    "app": "Order Service"
  }'`;
