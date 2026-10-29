package expo.modules.smsuserconsent

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import androidx.core.os.BundleCompat
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.Serializable
import kotlin.coroutines.resume

/** Carries nothing: the consent screen's own Intent is not Serializable, so the contract holds it instead (see [ConsentContract.pending]). */
internal class ConsentInput : Serializable

/**
 * Google's "allow this app to read this message?" screen. The result is the text of the one message the user allowed, or null when
 * they declined.
 */
internal class ConsentContract : AppContextActivityResultContract<ConsentInput, String?> {
  @Volatile
  var pending: Intent? = null

  override fun createIntent(context: Context, input: ConsentInput): Intent =
    requireNotNull(pending) { "There is no SMS consent screen to show" }

  override fun parseResult(input: ConsentInput, resultCode: Int, intent: Intent?): String? =
    if (resultCode == Activity.RESULT_OK) intent?.getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE) else null
}

/**
 * Reads the one-time code SMS with Google's SMS User Consent API — no SMS permission, and (unlike the SMS Retriever API) no app hash
 * in the message, so the DLT-approved template stays exactly as registered. The user sees Google's own one-tap consent screen
 * before the app receives the message text. Android only; Google Play services does the listening for up to five minutes.
 */
class SmsUserConsentModule : Module() {
  private val contract = ConsentContract()
  private lateinit var consentLauncher: AppContextActivityResultLauncher<ConsentInput, String?>
  private var receiver: BroadcastReceiver? = null
  private var waiting: CancellableContinuation<Intent?>? = null

  override fun definition() = ModuleDefinition {
    Name("SmsUserConsent")

    // Resolves with the text of the message the user allowed, or null (declined, nothing arrived in five minutes, or cancel() was called).
    AsyncFunction("readCodeMessageAsync") Coroutine { ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      settle(null) // a listener from an earlier screen must not outlive this one
      val consentIntent = awaitConsentIntent(context) ?: return@Coroutine null
      if (!::consentLauncher.isInitialized) return@Coroutine null
      contract.pending = consentIntent
      consentLauncher.launch(ConsentInput())
    }

    // Stops listening. The sign-in screen calls this when it closes, so the consent screen cannot appear over some other screen later.
    Function("cancel") { ->
      settle(null)
    }

    RegisterActivityContracts {
      consentLauncher = registerForActivityResult(contract)
    }

    OnDestroy {
      settle(null)
    }
  }

  private suspend fun awaitConsentIntent(context: Context): Intent? = suspendCancellableCoroutine<Intent?> { continuation ->
    val listener = object : BroadcastReceiver() {
      override fun onReceive(receivedBy: Context?, intent: Intent?) {
        val received = intent ?: return
        if (received.action != SmsRetriever.SMS_RETRIEVED_ACTION) return
        val extras = received.extras ?: return
        val status = BundleCompat.getParcelable(extras, SmsRetriever.EXTRA_STATUS, Status::class.java)
        // SUCCESS carries the consent screen to show; anything else (TIMEOUT after five minutes) ends the wait with nothing.
        val consent = if (status?.statusCode == CommonStatusCodes.SUCCESS) {
          BundleCompat.getParcelable(extras, SmsRetriever.EXTRA_CONSENT_INTENT, Intent::class.java)
        } else {
          null
        }
        settle(consent)
      }
    }
    synchronized(this@SmsUserConsentModule) {
      receiver = listener
      waiting = continuation
    }
    continuation.invokeOnCancellation { settle(null) }
    // Only Google Play services (which holds SEND_PERMISSION) may deliver to this receiver.
    ContextCompat.registerReceiver(
      context,
      listener,
      IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION),
      SmsRetriever.SEND_PERMISSION,
      null,
      ContextCompat.RECEIVER_EXPORTED
    )
    SmsRetriever.getClient(context).startSmsUserConsent(null).addOnFailureListener { settle(null) }
  }

  /** Ends the wait with `consent` (null = nothing) and stops listening. Safe to call any number of times. */
  private fun settle(consent: Intent?) {
    val (listener, wait) = synchronized(this) {
      val taken = Pair(receiver, waiting)
      receiver = null
      waiting = null
      taken
    }
    if (listener != null) {
      runCatching { appContext.reactContext?.unregisterReceiver(listener) }
    }
    if (wait != null && wait.isActive) {
      wait.resume(consent)
    }
  }
}
